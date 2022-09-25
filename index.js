const fs = require('fs').promises;
const axios = require('axios');
const axiosRetry = require('axios-retry');
const dotenv = require('dotenv');

dotenv.config();

String.prototype.replaceAll = function(org, dest) {
  return this.split(org).join(dest);
}

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

const infoDic = {};
const scoreDic = {};

function ConvertSimplifiedName(nickname) {
  return nickname.toLowerCase().replace(' ','');
}

const resultCache = {};
async function main() {
  try {
    const userListText = await fs.readFile('nicknames.txt', 'utf8');
    const users = userListText.split('\r\n');
    if (users.length <= 1)
      throw new Error('닉네임이 2개 이상 입력되어야 합니다.');

    for (const user of users) {
      const parsed = user.split(',');
      const nickname = parsed[0];
      const score = parsed.length > 1 ? Number(parsed[1]) : 1;
      const simplifiedName = ConvertSimplifiedName(nickname);
      infoDic[simplifiedName] = await GetSummonerInfo(nickname);
      scoreDic[simplifiedName] = score;
    }

    for (const user of users) {
      const parsed = user.split(',');
      const nickname = parsed[0];
      const simpplifiedName = ConvertSimplifiedName(nickname);
      console.log(`nickname ${nickname}`);
      if (!await GetMatchListUntil(nickname, targetDate.getTime())) {
        resultCache[simpplifiedName] = 0;
      }
    }

    // json to csv
    let csv = '"nickname","count","point","onePointCount","list"\n';
    for (const user of users) {
      const parsed = user.split(',');
      const nickname = parsed[0];
      const simpplifiedName = ConvertSimplifiedName(nickname);
      csv += `"${nickname}",`;
      if (resultCache[simpplifiedName] == 0) {
        csv += `${resultCache[simpplifiedName]}\n`;
      }
      else {
        let json = JSON.stringify([...resultCache[simpplifiedName]]);
        json = json.replaceAll('"','');
        json = json.replaceAll(',','|');

        let onePointCount = 0;
        let score = Math.floor(scoreDic[simpplifiedName] / 3) * 2;
        resultCache[simpplifiedName].forEach((nickname) => {
          let userPoint = scoreDic[ConvertSimplifiedName(nickname)];
          score += userPoint;
          if (userPoint == 1)
            onePointCount++;
        });

        csv += `${resultCache[simpplifiedName].size},${score},${onePointCount},${json}\n`;
      }
      
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
    const uintArray = await fs.readFile(`./cache/${cacheKey}`);
    if (!uintArray)
      return;
  
    const str = new TextDecoder().decode(uintArray);
    return JSON.parse(str);
  } catch (e) {
    return;
  }
}

async function SetCache(cacheKey, text)
{
  await fs.writeFile(`./cache/${cacheKey}`, String(text));
}

async function GetSummonerInfo(nickname)
{
  if (nickname == '')
    return 'nickname is empty';

  const cacheKey = `summonerInfo_${nickname}`;
  let info = await GetCache(cacheKey);
  if (!info || info == '')
  {
    info = await Request(`https://kr.api.riotgames.com/lol/summoner/v4/summoners/by-name/${nickname}`);
    if (info.puuid == undefined && info.response.status != 200)
      throw new Error(`${nickname}`);

    await SetCache(cacheKey, JSON.stringify(info));
  }

  return info;
}

function GetTeamId(matchData, puuid)
{
  try {
    const participantInfo = matchData.info.participants.find(elem => elem.puuid == puuid);
    return participantInfo.teamId;
  } catch (e) {
    console.log(`puuid:${puuid} Error - ${e}`);
    return null;
  }
}

async function GetMatchListUntil(nickname, until)
{
  let tryCount = 0;
  let beginIndex = 0;
  const simpplifiedName = ConvertSimplifiedName(nickname);

  while (tryCount++ < requestLimitCount) {
    const matchIds = await GetMatchList(nickname, beginIndex, beginIndex + 100);
    sleep(1000);
    
    if (matchIds.length == 0)
      break;

    for (let i = 0; i < matchIds.length; ++i)
    {
      const matchId = matchIds[i];
      let matchData = await GetCache(`gameid_${matchId}`);
      if (!matchData) {
        matchData = await GetMatchData(matchId);
        sleep(1000);
      }

      if (!matchData || matchData.gameType == 'CUSTOM_GAME')
        continue;

      try
      {
        if (matchData.info == undefined) {
          console.log('maybe rate limit exceeded');
          i--;
          sleep(15000);
          continue;
        }

        if (matchData.info.gameCreation < until) {
          tryCount = requestLimitCount;
          break;
        }

        const playerTeamId = GetTeamId(matchData, infoDic[simpplifiedName].puuid);

        for (let participant of matchData.info.participants)
        {
          const summonerName = participant.summonerName;
          const targetSimplifiedName = ConvertSimplifiedName(participant.summonerName);
          if (targetSimplifiedName != simpplifiedName && infoDic[targetSimplifiedName])
          {
            const teamId = GetTeamId(matchData, infoDic[targetSimplifiedName].puuid);
            if (!teamId) {
              tryCount = requestLimitCount;
              break;
            }

            if (teamId != playerTeamId)
              continue;

            if (!resultCache[simpplifiedName])
              resultCache[simpplifiedName] = new Set();

            resultCache[simpplifiedName].add(summonerName);

            if (!resultCache[targetSimplifiedName])
              resultCache[targetSimplifiedName] = new Set();

            resultCache[targetSimplifiedName].add(nickname);
          }
        }
      }
      catch (e)
      {
        console.log(e);
        return `${matchId} ${JSON.stringify(matchData)}`;
      }
    }

    beginIndex += 100;
  }

  return !!resultCache[simpplifiedName];
}

async function GetMatchData(matchId)
{
  if (matchId == '')
    return;

  const cacheKey = `gameid_${matchId}`;
  let matchData = await GetCache(cacheKey);
  if (!matchData || matchData == '')
  {
    matchData = await Request(`https://asia.api.riotgames.com/lol/match/v5/matches/${matchId}`);
    await SetCache(cacheKey, JSON.stringify(matchData));
  }

  return matchData;
}

async function GetMatchList(nickname, beginIndex)
{
  if (nickname == '')
    return "nickname is empty";

  const info = await GetSummonerInfo(nickname);
  const result = await Request(`https://asia.api.riotgames.com/lol/match/v5/matches/by-puuid/${info.puuid}/ids`, { start: beginIndex, count: 100 });
  return result;
}

async function Request(url, params)
{
  let requestUrl = url;
  try {
    const result = await axios.get(encodeURI(requestUrl), { 
      params,
      headers: {
        'X-Riot-Token': process.env.api_key
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

function sleep(ms) {
  const wakeUpTime = Date.now() + ms;
  while (Date.now() < wakeUpTime) {}
}