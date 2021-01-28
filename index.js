const fs = require('fs').promises;
const axios = require('axios');
const axiosRetry = require('axios-retry');
const dotenv = require('dotenv');

dotenv.config();

const urlPrefix = "https://acs.leagueoflegends.com/v1/";

const requestLimitCount = 30;

axiosRetry(axios, { retries: 3 });
axiosRetry(axios, { retryDelay: (retryCount) => {
  return retryCount * 1000;
}});

const myArgs = process.argv.slice(2);
const targetDateStr = myArgs[0];
const [year, month, day] = targetDateStr.split("-");
const targetDate = new Date(year, month - 1, day);

if (new Date() - targetDate >= 86400 * 90 * 1000)
  throw new Error('현재로부터 3개월을 초과하는 인자는 넣을 수 없습니다.');

const accountIdDic = {};

const resultCache = {};
async function main() {
  try {
    const nicknameText = await fs.readFile('nicknames.txt', 'utf8');
    const nicknames = nicknameText.split('\r\n');
    if (nicknames.length <= 1)
      throw new Error('닉네임이 2개 이상 입력되어야 합니다.');

    for (const nickname of nicknames) {
      accountIdDic[nickname] = await GetAccountId_V1(nickname);
    }

    for (const nickname of nicknames) {
      if (resultCache[nickname])
        continue;

        console.log(`nickname ${nickname}`);
        if (!await GetMatchListUntil_V1(nickname, targetDate.getTime())) {
          resultCache[nickname] = 'NOT OK';
        }
    }

    // json to csv
    let csv = '"nickname","result"\n';
    for (const nickname of nicknames) {
      csv += `"${nickname}","${resultCache[nickname]}"\n`;
    }

    await fs.writeFile(`./result_${new Date().toLocaleDateString()}.csv`, '\uFEFF' + csv, 'utf-8');
  } catch (e) {
    console.log(e);
  }
}

main();

async function GetCache(cacheKey)
{
  try {
    const text = await fs.readFile(`./cache/${cacheKey}`);
    if (text == '')
      return;
  
    return text;  
  } catch (e) {
    return;
  }
}

async function SetCache(cacheKey, text)
{
  await fs.writeFile(`./cache/${cacheKey}`, text);
}

async function GetAccountId_V1(nickname)
{
  if (nickname == '')
    return 'nickname is empty';

  const cacheKey = `accountid_${nickname}`;
  let accountId = await GetCache(cacheKey);
  if (!accountId || accountId == '')
  {
    const result = await Request('players/', {
      name: nickname,
      region: 'KR'
    });

    accountId = result["accountId"];
    if (!accountId)
      throw new Error(`${nickname}은 없는 닉네임입니다.`);

    await SetCache(cacheKey, accountId);
  }

  return accountId;
}

async function GetMatchListUntil_V1(nickname, until)
{
  let tryCount = 0;
  let beginIndex = 0;
  let endIndex = 10;

  while (tryCount++ < requestLimitCount) {
    const matchList = await GetMatchList_V1(nickname, beginIndex, endIndex);

    const games = matchList.games.games;
    if (games.length == 0)
      break;

    for (let i = games.length - 1; i >= 0; --i)
    {
      const game = games[i];
      const matchData = await GetMatchData_V1(game.gameId);
      if (!matchData || matchData.gameType == 'CUSTOM_GAME')
        continue;
        
      try
      {
        if (matchData.gameCreation < until) {
          tryCount = requestLimitCount;
          break;
        }

        for (let participant of matchData.participantIdentities)
        {
          if (participant.player.summonerName != nickname && accountIdDic[participant.player.summonerName])
          {
            const dateStr = new Date(matchData.gameCreation).toLocaleDateString();
            
            if (!resultCache[nickname])
              resultCache[nickname] = `${dateStr} - ${participant.player.summonerName}`;

            if (!resultCache[participant.player.summonerName])
              resultCache[participant.player.summonerName] = `${dateStr} - ${nickname}`;
          }
        }
      }
      catch (e)
      {
        console.log(e);
        return `${game.gameId} ${JSON.stringify(matchData)}`;
      }
    }

    beginIndex += 10;
    endIndex += 10;
  }

  return !!resultCache[nickname];
}

async function GetMatchData_V1(matchId)
{
  if (matchId == '')
    return;

  const cacheKey = `gameid_${matchId}`;
  let matchData = await GetCache(cacheKey);
  if (!matchData || matchData == '')
  {
    matchData = await Request(`stats/game/KR/${matchId}`);
    await SetCache(cacheKey, JSON.stringify(matchData));
  }
  else
  {
    matchData = JSON.parse(matchData);
  }

  return matchData;
}

async function GetMatchList_V1(nickname, begIndex, endIndex)
{
  if (nickname == '')
    return "nickname is empty";

  const accountId = await GetAccountId_V1(nickname);
  const result = await Request('stats/player_history/KR/' + accountId, {
    begIndex,
    endIndex
  });
  return result;
}

async function Request(url, params)
{
  let requestUrl = urlPrefix + url;
  try {
    const result = await axios.get(requestUrl, { 
      params,
      headers: {
        'cookie': 'id_token=' + process.env.id_token
      }
    });

    if (result.status != 200) {
      throw new Error('status is not 200');
    }

    if (Object.keys(result.data).length == 0) {
      throw new Error('empty data');
    }

    if (result.name == 'Error') {
      throw new Error('riot api error');
    }

    return result.data;
  }
  catch (e) {
    console.log(e);
    return e;
  }
}