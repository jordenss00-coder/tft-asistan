const fs = require('fs');
const path = require('path');
const cache = require('../cache');
const { PLATFORMS } = require('../riot');

const TIERS = ['challenger', 'grandmaster', 'master'];
const MAX_PLAYERS = 200;
const MATCHES_PER_PLAYER = 20;
const MATCH_WINDOW_DAYS = 14;
const LADDER_MAX_AGE = 3 * 60 * 60 * 1000;
const PAUSE_BETWEEN_PASSES = 30 * 60 * 1000;
const RANKED_QUEUE = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Riot'un bildirdiği uygulama limitlerine göre istekleri eşit aralıklarla gönderir. */
class RateLimiter {
  constructor() {
    this.spacing = 1250; // geliştirici anahtarı: 100 istek / 120 sn
    this.next = 0;
  }

  update(headers) {
    const limits = headers?.get?.('x-app-rate-limit');
    if (!limits) return;
    let spacing = 0;
    for (const part of limits.split(',')) {
      const [count, seconds] = part.split(':').map(Number);
      if (count && seconds) spacing = Math.max(spacing, (seconds * 1000) / count);
    }
    if (spacing) this.spacing = Math.ceil(spacing * 1.05);
  }

  async wait() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.spacing;
    if (at > now) await sleep(at - now);
  }
}

function patchOf(gameVersion) {
  const s = String(gameVersion || '');
  return (s.match(/<Releases\/(\d+\.\d+)>/) || s.match(/Version (\d+\.\d+)/) || [])[1] || null;
}

/** Maçı yalnızca istatistik için gereken alanlara indirger (disk ve bellek tasarrufu). */
function compact(match) {
  const info = match.info;
  return {
    id: match.metadata.match_id,
    date: info.game_datetime,
    patch: patchOf(info.game_version),
    set: info.tft_set_number,
    rows: info.participants.map((p) => ({
      p: p.placement,
      l: p.level,
      r: p.last_round,
      g: p.gold_left,
      a: p.augments || [],
      u: (p.units || []).map((u) => [u.character_id, u.tier || 1, u.itemNames || []]),
      t: (p.traits || []).filter((t) => t.tier_current > 0).map((t) => [t.name, t.num_units, t.tier_current, t.tier_total]),
    })),
  };
}

class Collector {
  constructor({ getSettings, getSetNumber, onStatus = () => {}, onNewMatches = () => {} }) {
    this.getSettings = getSettings;
    this.getSetNumber = getSetNumber;
    this.onStatus = onStatus;
    this.onNewMatches = onNewMatches;
    this.limiter = new RateLimiter();
    this.running = false;
    this.ids = new Set();
    this.skip = new Set();
    this.state = { running: false, matches: 0, players: 0, playerIndex: 0, phase: 'idle', error: null, lastMatchAt: null };
    this.loaded = false;
  }

  file(setNumber) {
    return path.join(cache.dataDir('engine'), `matches-set${setNumber}.jsonl`);
  }

  load() {
    const setNumber = this.getSetNumber();
    if (this.loaded === setNumber) return;
    this.ids.clear();
    try {
      for (const line of fs.readFileSync(this.file(setNumber), 'utf8').split('\n')) {
        const m = line.match(/^\{"id":"([^"]+)"/);
        if (m) this.ids.add(m[1]);
      }
    } catch { /* henüz veri yok */ }
    this.loaded = setNumber;
    this.setStatus({ matches: this.ids.size });
  }

  setStatus(patch) {
    this.state = { ...this.state, ...patch };
    this.onStatus(this.state);
  }

  status() {
    return { ...this.state, requestSpacingMs: this.limiter.spacing };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.setStatus({ running: true, error: null });
    this.loop();
  }

  stop() {
    this.running = false;
    this.setStatus({ running: false, phase: 'idle' });
  }

  async request(url, key, attempt = 0) {
    await this.limiter.wait();
    const res = await fetch(url, { headers: { 'X-Riot-Token': key } }).catch((e) => ({ networkError: e }));
    if (res.networkError) {
      if (attempt < 3) { await sleep(5000); return this.request(url, key, attempt + 1); }
      throw new Error('Riot API\'ye bağlanılamadı.');
    }
    this.limiter.update(res.headers);
    if (res.status === 429 && attempt < 6) {
      await sleep((Number(res.headers.get('retry-after')) || 10) * 1000 + 500);
      return this.request(url, key, attempt + 1);
    }
    if (res.status >= 500 && attempt < 3) { await sleep(3000); return this.request(url, key, attempt + 1); }
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Riot API anahtarı geçersiz ya da süresi dolmuş.');
      err.fatal = true;
      throw err;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Riot API hatası (HTTP ${res.status}).`);
    return res.json();
  }

  async ladder(settings, platform) {
    const cached = cache.read(`ladder_${platform}`, LADDER_MAX_AGE);
    if (cached?.fresh) return cached.data;
    this.setStatus({ phase: 'ladder' });
    const entries = [];
    for (const tier of TIERS) {
      const list = await this.request(`https://${platform}.api.riotgames.com/tft/league/v1/${tier}?queue=RANKED_TFT`, settings.riotApiKey);
      for (const e of list?.entries || []) entries.push({ ...e, tier });
      if (entries.length >= MAX_PLAYERS) break;
    }
    entries.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.leaguePoints - a.leaguePoints);
    const puuids = [];
    for (const e of entries.slice(0, MAX_PLAYERS)) {
      if (e.puuid) { puuids.push(e.puuid); continue; }
      if (!e.summonerId) continue;
      const summoner = await this.request(`https://${platform}.api.riotgames.com/tft/summoner/v1/summoners/${e.summonerId}`, settings.riotApiKey);
      if (summoner?.puuid) puuids.push(summoner.puuid);
    }
    cache.write(`ladder_${platform}`, puuids);
    return puuids;
  }

  async loop() {
    while (this.running) {
      try {
        await this.pass();
        if (!this.running) break;
        this.setStatus({ phase: 'waiting' });
        await sleep(PAUSE_BETWEEN_PASSES);
      } catch (e) {
        this.setStatus({ error: e.message, phase: 'error' });
        if (e.fatal) { this.stop(); break; }
        await sleep(60 * 1000);
      }
    }
  }

  async pass() {
    const settings = this.getSettings();
    if (!settings.riotApiKey) {
      const err = new Error('Riot API anahtarı yok.');
      err.fatal = true;
      throw err;
    }
    const setNumber = this.getSetNumber();
    this.load();
    const platform = String(settings.platform || 'tr1').toLowerCase();
    const region = PLATFORMS[platform];
    if (!region) throw new Error(`Geçersiz sunucu: ${platform}`);

    const puuids = await this.ladder(settings, platform);
    this.setStatus({ players: puuids.length, error: null });
    const startTime = Math.floor((Date.now() - MATCH_WINDOW_DAYS * 86400000) / 1000);
    const file = this.file(setNumber);
    let added = 0;

    for (let i = this.state.playerIndex % Math.max(1, puuids.length); i < puuids.length; i++) {
      if (!this.running) return;
      this.setStatus({ phase: 'matches', playerIndex: i });
      const ids = await this.request(`https://${region}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuids[i]}/ids?count=${MATCHES_PER_PLAYER}&startTime=${startTime}`, settings.riotApiKey) || [];
      for (const id of ids) {
        if (!this.running) return;
        if (this.ids.has(id) || this.skip.has(id)) continue;
        const match = await this.request(`https://${region}.api.riotgames.com/tft/match/v1/matches/${id}`, settings.riotApiKey);
        if (!match?.info || match.info.queue_id !== RANKED_QUEUE || match.info.tft_set_number !== setNumber) {
          this.skip.add(id);
          continue;
        }
        fs.appendFileSync(file, `${JSON.stringify(compact(match))}\n`);
        this.ids.add(id);
        added++;
        this.setStatus({ matches: this.ids.size, lastMatchAt: Date.now() });
        if (added % 25 === 0) this.onNewMatches(this.ids.size);
      }
    }
    this.setStatus({ playerIndex: 0 });
    if (added) this.onNewMatches(this.ids.size);
  }
}

module.exports = { Collector, compact, patchOf };
