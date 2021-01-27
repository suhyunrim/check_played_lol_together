const fs = require('fs').promises;
const axios = require('axios');
const axiosRetry = require('axios-retry');

const tokenId = "id_token=";
const urlPrefix = "https://acs.leagueoflegends.com/v1/";

const requestLimitCount = 30;

axiosRetry(axios, { retries: 3 });
axiosRetry(axios, { retryDelay: (retryCount) => {
  return retryCount * 1000;
}});

const accountIdDic = {};

async function main() {
  try {
    const nicknameText = await fs.readFile('nicknames.txt', 'utf8');
    const nicknames = nicknameText.split('\r\n');
    for (const nickname of nicknames) {
      accountIdDic[nickname] = await GetAccountId_V1(nickname);
    }

    let resultList = '';
    for (const nickname of nicknames) {
      const result = await GetMatchListUntil_V1(nickname, 1609528629000);
      resultList += `${nickname} ${result}\n`;
      console.log(`nickname ${nickname}  ${result}`);
    }
    await fs.writeFile('./test.txt', resultList);
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
    await SetCache(cacheKey, accountId);
  }

  return accountId;
}

async function GetMatchListUntil_V1(nickname, until)
{
  let tryCount = 0;
  let beginIndex = 0;
  let endIndex = 10;

  let result = "NOT OK";
  while (tryCount++ < requestLimitCount) {
    const matchList = await GetMatchList_V1(nickname, beginIndex, endIndex);

    const games = matchList.games.games;
    if (games.length == 0)
      break;

    for (let i = games.length - 1; i >= 0; --i)
    {
      const game = games[i];
      const matchData = await GetMatchData_V1(game.gameId);
      if (!matchData)
        continue;
        
      try
      {
        if (matchData.gameCreation < until) {
          return "NOT OK(기간 초과)";
        }

        for (let participant of matchData.participantIdentities)
        {
          if (participant.player.summonerName != nickname && accountIdDic[participant.player.summonerName])
          {
            const dateStr = new Date(timestamp).toLocaleDateString();
            return `${dateStr} - ${participant.player.summonerName}`;
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

  result += ` ${beginIndex} ${endIndex}`;
  return result;
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
        'cookie': tokenId
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