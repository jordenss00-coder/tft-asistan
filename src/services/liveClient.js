const https = require('https');

// Riot'un yerel oyun istemcisi (127.0.0.1:2999) kendinden imzalı sertifika kullanır.
// Bu ajan yalnızca yerel istemci sorguları için kullanılır.
const agent = new https.Agent({ rejectUnauthorized: false });

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: 2999, path, agent, timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

let timer = null;
let lastKey = null;

/** Oyunun açılıp kapandığını algılar. Yalnızca oyun modu bilgisini okur, rakip verisi okumaz. */
function start(onChange, intervalMs = 3000) {
  stop();
  const tick = async () => {
    let state;
    try {
      const s = await getJson('/liveclientdata/gamestats');
      state = { inGame: true, isTft: String(s.gameMode || '').toUpperCase() === 'TFT', mode: s.gameMode || '' };
    } catch {
      state = { inGame: false, isTft: false, mode: '' };
    }
    const key = `${state.inGame}|${state.isTft}`;
    if (key !== lastKey) {
      lastKey = key;
      onChange(state);
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
