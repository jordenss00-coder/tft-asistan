const { execFile } = require('child_process');

// TFT, League'in aksine yerel oyun API'sini (127.0.0.1:2999) açmaz; bu yüzden oyun,
// çalışan süreçten algılanır. Yalnızca sürecin varlığına bakılır, oyun verisi okunmaz.
const TFT_PROCESS = 'TFTClient-Win64-Shipping.exe';
const LOL_PROCESS = 'League of Legends.exe';

function isRunning(imageName) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(!err && String(stdout).toLowerCase().includes(imageName.toLowerCase()));
    });
  });
}

let timer = null;
let lastKey = null;

/** Oyunun açılıp kapandığını algılar. */
function start(onChange, intervalMs = 4000) {
  stop();
  const tick = async () => {
    const tft = await isRunning(TFT_PROCESS);
    const lol = tft ? false : await isRunning(LOL_PROCESS);
    const state = { inGame: tft || lol, isTft: tft, mode: tft ? 'TFT' : lol ? 'CLASSIC' : '' };
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
  lastKey = null;
}

module.exports = { start, stop };
