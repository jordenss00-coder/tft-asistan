const { fetchJson } = require('./http');
const cache = require('./cache');

const PLATFORMS = {
  tr1: 'europe', euw1: 'europe', eun1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea', ph2: 'sea', th2: 'sea',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function riotGet(url, key, attempt = 0) {
  try {
    return await fetchJson(url, { headers: { 'X-Riot-Token': key } });
  } catch (e) {
    if (e.status === 429 && attempt < 5) {
      const wait = (Number(e.headers?.get('retry-after')) || 5) * 1000;
      await sleep(wait + 250);
      return riotGet(url, key, attempt + 1);
    }
    if (e.status >= 500 && attempt < 2) {
      await sleep(1500);
      return riotGet(url, key, attempt + 1);
    }
    if (e.status === 401 || e.status === 403) {
      throw new Error('Riot API anahtarı geçersiz ya da süresi dolmuş. Geliştirici anahtarları 24 saatte bir yenilenir; developer.riotgames.com adresinden yeni anahtar alıp Ayarlar\'a gir.');
    }
    if (e.status === 404) {
      const err = new Error('Riot API: kayıt bulunamadı.');
      err.status = 404;
      throw err;
    }
    throw e.status ? new Error(`Riot API hatası (HTTP ${e.status}).`) : e;
  }
}

function parseRiotId(riotId) {
  const m = String(riotId || '').trim().match(/^(.+?)\s*#\s*([^#]+)$/);
  if (!m) throw new Error('Riot ID "Ad#ETİKET" biçiminde olmalı (ör. Oyuncu#TR1).');
  return { gameName: m[1].trim(), tagLine: m[2].trim() };
}

async function getRecentMatches(settings, count, onProgress = () => {}) {
  const key = settings.riotApiKey;
  if (!key) throw new Error('Riot API anahtarı eksik. Ayarlar sayfasından ekle.');
  const platform = String(settings.platform || 'tr1').toLowerCase();
  const region = PLATFORMS[platform];
  if (!region) throw new Error(`Geçersiz sunucu: ${platform}`);
  const accountRegion = region === 'sea' ? 'asia' : region;
  const { gameName, tagLine } = parseRiotId(settings.riotId);

  const accountKey = `account_${platform}_${gameName}_${tagLine}`.toLowerCase();
  // İstemciden algılanan hesaplarda PUUID zaten bilinir; ek hesap sorgusuna gerek yoktur.
  let account = settings.puuid ? { puuid: settings.puuid, gameName, tagLine } : cache.read(accountKey)?.data;
  if (!account) {
    try {
      account = await riotGet(`https://${accountRegion}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, key);
    } catch (e) {
      if (e.status === 404) throw new Error(`"${gameName}#${tagLine}" hesabı bulunamadı. Riot ID ve etiketi kontrol et.`);
      throw e;
    }
    cache.write(accountKey, account);
  }

  onProgress({ step: 'ids', done: 0, total: count });
  const ids = await riotGet(`https://${region}.api.riotgames.com/tft/match/v1/matches/by-puuid/${account.puuid}/ids?start=0&count=${count}`, key);

  let rank = null;
  try {
    const entries = await riotGet(`https://${platform}.api.riotgames.com/tft/league/v1/by-puuid/${account.puuid}`, key);
    rank = (entries || []).find((e) => e.queueType === 'RANKED_TFT') || null;
  } catch { /* rank bilgisi opsiyonel */ }

  const matches = [];
  for (let i = 0; i < ids.length; i++) {
    let m = cache.read(ids[i], Infinity, ['matches'])?.data;
    if (!m) {
      try {
        m = await riotGet(`https://${region}.api.riotgames.com/tft/match/v1/matches/${ids[i]}`, key);
        cache.write(ids[i], m, ['matches']);
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      await sleep(60);
    }
    if (m) matches.push(m);
    onProgress({ step: 'matches', done: i + 1, total: ids.length });
  }

  return {
    account: { puuid: account.puuid, gameName: account.gameName || gameName, tagLine: account.tagLine || tagLine, platform },
    rank,
    matches,
  };
}

module.exports = { getRecentMatches, PLATFORMS };
