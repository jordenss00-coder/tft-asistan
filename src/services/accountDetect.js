const https = require('https');
const { execFile } = require('child_process');

// League istemcisinin bildirdiği bölge → Riot API platform kodu
const REGION_TO_PLATFORM = {
  TR: 'tr1', EUW: 'euw1', EUNE: 'eun1', RU: 'ru', ME1: 'me1',
  NA: 'na1', BR: 'br1', LAN: 'la1', LA1: 'la1', LAS: 'la2', LA2: 'la2',
  KR: 'kr', JP: 'jp1', OCE: 'oc1', OC1: 'oc1', SG2: 'sg2', TW2: 'tw2', VN2: 'vn2', PH2: 'ph2', TH2: 'th2',
};

// Yerel Riot istemcileri kendinden imzalı sertifika kullanır; yalnızca 127.0.0.1 için.
const agent = new https.Agent({ rejectUnauthorized: false });

function localGet(port, path, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Basic ${Buffer.from(`riot:${token}`).toString('base64')}` } : {};
    const req = https.get({ host: '127.0.0.1', port, path, agent, headers, timeout: 2500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
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

/** Çalışan League istemcisinin yerel API portunu ve erişim anahtarını komut satırından okur. */
function clientCredentials() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const cmd = "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -First 1).CommandLine";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const port = stdout.match(/--app-port=(\d+)/)?.[1];
      const token = stdout.match(/--remoting-auth-token=([\w-]+)/)?.[1];
      resolve(port && token ? { port: Number(port), token } : null);
    });
  });
}

/** Açık istemcide oturum açmış hesabı döndürür; bulunamazsa null. Yalnızca kendi hesap bilgini okur. */
async function detect() {
  const creds = await clientCredentials();
  if (creds) {
    try {
      const me = await localGet(creds.port, '/lol-summoner/v1/current-summoner', creds.token);
      if (me?.gameName && me?.tagLine) {
        let platform = null;
        try {
          const rl = await localGet(creds.port, '/riotclient/region-locale', creds.token);
          platform = REGION_TO_PLATFORM[String(rl?.region || '').toUpperCase()] || null;
        } catch { /* bölge bilgisi opsiyonel */ }
        return { riotId: `${me.gameName}#${me.tagLine}`, platform, puuid: me.puuid || null, source: 'client' };
      }
    } catch { /* istemci henüz hazır değil */ }
  }
  try {
    const name = await localGet(2999, '/liveclientdata/activeplayername');
    if (typeof name === 'string' && name.includes('#')) return { riotId: name, platform: null, puuid: null, source: 'game' };
  } catch { /* oyun açık değil */ }
  return null;
}

module.exports = { detect };
