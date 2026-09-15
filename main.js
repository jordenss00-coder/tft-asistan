const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, clipboard, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const store = require('./src/services/store');
const cache = require('./src/services/cache');
const staticData = require('./src/services/staticData');
const meta = require('./src/services/meta');
const riot = require('./src/services/riot');
const gemini = require('./src/services/gemini');
const coach = require('./src/services/coach');
const liveClient = require('./src/services/liveClient');
const accountDetect = require('./src/services/accountDetect');
const { analyze } = require('./src/services/analysis');
const { plan } = require('./src/services/planner');
const { Collector } = require('./src/services/engine/collector');
const { buildStats } = require('./src/services/engine/stats');
const { coachNow } = require('./src/services/engine/index');
const screenReader = require('./src/services/ocr/screenReader');

const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, 'src', 'renderer');
const EXTERNAL_HOSTS = new Set([
  'github.com',
  'developer.riotgames.com', 'aistudio.google.com', 'ai.google.dev',
  'www.metatft.com', 'tactics.tools', 'tftacademy.com', 'lolchess.gg', 'tftflow.com', 'bunnymuffins.lol',
]);
const SETTINGS_KEYS = [
  'riotId', 'platform', 'riotApiKey', 'geminiApiKey', 'geminiModel',
  'overlayHotkey', 'clickThroughHotkey', 'autoOverlay', 'overlayOpacity', 'disabledSources', 'accountMode', 'engineAutoCollect', 'ocrEnabled', 'ocrRegions',
];

let mainWin = null;
let overlayWin = null;
let clickThrough = false;
let gameState = { inGame: false, isTft: false, mode: '' };
let lastAnalysis = null;
let updateState = { status: 'idle' };
let collector = null;
let engineStats = null;
let statsTimer = null;
let statsBuilding = false;
let liveState = {};
let ocrTimer = null;
let ocrBusy = false;
let lastCapture = null;

if (!app.requestSingleInstanceLock()) app.quit();

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  broadcast('update:status', updateState);
}

/** GitHub Releases üzerinden güncellemeleri arka planda indirir; kurulum kapanışta veya kullanıcı isteyince yapılır. */
function initUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => setUpdateState({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'latest' }));
  autoUpdater.on('download-progress', (p) => setUpdateState({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setUpdateState({ status: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => setUpdateState({ status: 'error', error: e.message }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

function broadcast(channel, payload) {
  for (const w of [mainWin, overlayWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname)) shell.openExternal(u.toString());
  } catch { /* geçersiz URL */ }
}

function webPreferences() {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

function harden(win) {
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); openExternal(url); }
  });
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1320, height: 880, minWidth: 1000, minHeight: 660,
    backgroundColor: '#0b0f17', title: 'TFT Asistan', autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  harden(mainWin);
  mainWin.loadFile(path.join(RENDERER, 'index.html'));
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

function clampOpacity(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0.4, n)) : 0.92;
}

function onSomeDisplay(b) {
  return b && screen.getAllDisplays().some(({ bounds: d }) =>
    b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y);
}

function createOverlay() {
  const saved = store.get().overlayBounds;
  const { workArea } = screen.getPrimaryDisplay();
  const bounds = onSomeDisplay(saved) ? saved : {
    width: 390, height: Math.min(700, workArea.height - 120),
    x: workArea.x + workArea.width - 414, y: workArea.y + 90,
  };
  // Windows'ta şeffaf pencereler yeniden boyutlandırılamadığı için saydamlık setOpacity ile verilir.
  overlayWin = new BrowserWindow({
    ...bounds, minWidth: 320, minHeight: 260,
    frame: false, resizable: true, alwaysOnTop: true, skipTaskbar: true, show: false,
    backgroundColor: '#0b0f17', opacity: clampOpacity(store.get().overlayOpacity),
    webPreferences: webPreferences(),
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  harden(overlayWin);
  overlayWin.loadFile(path.join(RENDERER, 'overlay.html'));

  let saveTimer;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (overlayWin && !overlayWin.isDestroyed()) store.set({ overlayBounds: overlayWin.getBounds() });
    }, 400);
  };
  overlayWin.on('move', saveBounds);
  overlayWin.on('resize', saveBounds);
  overlayWin.on('show', () => broadcast('overlay:visible', true));
  overlayWin.on('hide', () => broadcast('overlay:visible', false));
  overlayWin.on('closed', () => { overlayWin = null; });
}

function setOverlayVisible(visible) {
  if (!overlayWin) createOverlay();
  if (visible) {
    overlayWin.showInactive();
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
  } else {
    overlayWin.hide();
  }
  return overlayWin.isVisible();
}

function setClickThrough(on) {
  if (!overlayWin) createOverlay();
  clickThrough = !!on;
  overlayWin.setIgnoreMouseEvents(clickThrough, { forward: true });
  broadcast('overlay:clickThrough', clickThrough);
  return clickThrough;
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const s = store.get();
  const failed = [];
  const reg = (accelerator, fn) => {
    if (!accelerator) return;
    try {
      if (!globalShortcut.register(accelerator, fn)) failed.push(accelerator);
    } catch {
      failed.push(accelerator);
    }
  };
  reg(s.overlayHotkey, () => setOverlayVisible(!(overlayWin && overlayWin.isVisible())));
  reg(s.clickThroughHotkey, () => setClickThrough(!clickThrough));
  return failed;
}

function rememberAccount(d) {
  const s = store.get();
  const list = (s.accounts || []).filter((a) => a.riotId.toLowerCase() !== d.riotId.toLowerCase());
  list.unshift({ riotId: d.riotId, platform: d.platform || s.platform, puuid: d.puuid || null, lastSeen: Date.now() });
  store.set({ accounts: list.slice(0, 10) });
}

async function detectAccount() {
  const d = await accountDetect.detect();
  if (d) rememberAccount(d);
  return d;
}

/** Analiz edilecek hesap: seçilen hesap > açık istemcideki hesap > Ayarlar'daki yedek Riot ID. */
async function resolveAccount(selected) {
  const s = store.get();
  if (selected?.riotId) return { riotId: selected.riotId, platform: selected.platform || s.platform, puuid: selected.puuid || null };
  if (s.accountMode !== 'manual') {
    const d = await detectAccount();
    if (d) return { riotId: d.riotId, platform: d.platform || s.platform, puuid: d.puuid || null };
  }
  if (s.riotId) return { riotId: s.riotId, platform: s.platform, puuid: null };
  throw new Error('Hesap algılanamadı. League/TFT istemcisini açık tut, listeden kayıtlı bir hesap seç ya da Ayarlar\'a yedek Riot ID gir.');
}

/* ── Ekran okuma ── */

const ocrRegions = () => store.get().ocrRegions || screenReader.DEFAULT_REGIONS;

async function ocrTick() {
  if (ocrBusy) return;
  ocrBusy = true;
  try {
    const cap = await screenReader.capture();
    if (cap.source !== 'game') return;
    const reading = await screenReader.read(cap.image, ocrRegions(), await staticData.load());
    broadcast('ocr:reading', reading);
  } catch (e) {
    broadcast('ocr:reading', { at: Date.now(), error: e.message });
  } finally {
    ocrBusy = false;
  }
}

function updateOcrLoop() {
  const on = !!store.get().ocrEnabled && gameState.inGame && gameState.isTft;
  if (on && !ocrTimer) ocrTimer = setInterval(ocrTick, 3000);
  if (!on && ocrTimer) {
    clearInterval(ocrTimer);
    ocrTimer = null;
  }
}

/* ── Kendi istatistik motoru ── */

async function loadEngineStats() {
  if (engineStats) return engineStats;
  const S = await staticData.load();
  engineStats = cache.read(`engine_stats_set${S.setNumber}`)?.data || null;
  return engineStats;
}

function engineSummary() {
  const st = engineStats;
  if (!st) return null;
  return {
    builtAt: st.builtAt,
    matches: st.matches,
    patches: st.patches,
    comps: st.comps.filter((c) => c.n >= 30).slice(0, 12)
      .map((c) => ({ name: c.name, n: c.n, avg: c.avg, top4: c.top4, carry: c.carry, trait: c.trait })),
    augments: Object.entries(st.augments).filter(([, a]) => a.n >= 30)
      .sort((a, b) => a[1].smoothed - b[1].smoothed).slice(0, 12)
      .map(([id, a]) => ({ id, n: a.n, avg: a.avg })),
  };
}

async function rebuildStats() {
  if (statsBuilding || !collector) return engineStats;
  statsBuilding = true;
  try {
    const S = await staticData.load();
    const m = await loadMeta().catch(() => null);
    engineStats = buildStats({ file: collector.file(S.setNumber), S, metaComps: m?.comps || [] });
    cache.write(`engine_stats_set${S.setNumber}`, engineStats);
    broadcast('engine:stats', engineSummary());
    return engineStats;
  } finally {
    statsBuilding = false;
  }
}

function scheduleStatsRebuild(delay = 20000) {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => rebuildStats().catch((e) => console.error('İstatistik hatası:', e.message)), delay);
}

async function initEngine() {
  const S = await staticData.load();
  collector = new Collector({
    getSettings: () => store.get(),
    getSetNumber: () => S.setNumber,
    onStatus: (s) => broadcast('engine:status', s),
    onNewMatches: () => scheduleStatsRebuild(),
  });
  collector.load();
  await loadEngineStats();
  if (collector.status().matches && (!engineStats || Date.now() - engineStats.builtAt > 60 * 60 * 1000)) scheduleStatsRebuild(30000);
  const s = store.get();
  if (s.engineAutoCollect && s.riotApiKey) collector.start();
}

async function loadMeta(force = false) {
  const S = await staticData.load();
  return meta.getComps(S, force, store.get().disabledSources || []);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { ok: true, data: await fn(payload, event) };
    } catch (e) {
      console.error(`[${channel}]`, e);
      return { ok: false, error: e.message || String(e) };
    }
  });
}

function registerIpc() {
  handle('settings:get', () => ({
    ...store.getPublic(),
    clickThrough,
    gameState,
    overlayVisible: !!(overlayWin && overlayWin.isVisible()),
  }));

  handle('settings:set', (partial = {}) => {
    const clean = {};
    for (const k of SETTINGS_KEYS) {
      if (partial[k] === undefined) continue;
      clean[k] = typeof partial[k] === 'string' ? partial[k].trim() : partial[k];
    }
    if (partial.clearRiotKey) clean.riotApiKey = '';
    if (partial.clearGeminiKey) clean.geminiApiKey = '';
    store.set(clean);
    if (clean.overlayOpacity !== undefined && overlayWin) overlayWin.setOpacity(clampOpacity(clean.overlayOpacity));
    if (collector) {
      const s = store.get();
      if (s.engineAutoCollect && s.riotApiKey) collector.start();
      else if (!s.engineAutoCollect) collector.stop();
    }
    updateOcrLoop();
    const failedHotkeys = registerHotkeys();
    const pub = store.getPublic();
    broadcast('settings:changed', pub);
    return { settings: pub, failedHotkeys };
  });

  handle('static:get', (opts = {}) => staticData.load(!!opts.force));

  handle('meta:get', async (opts = {}) => {
    const data = await loadMeta(!!opts.force);
    if (opts.force) broadcast('meta:updated', data.fetchedAt);
    return data;
  });

  handle('meta:sources', () => meta.sourceInfo());

  handle('planner:plan', async ({ trait, target } = {}) => {
    const S = await staticData.load();
    const m = await loadMeta().catch(() => null);
    return plan(S, m?.comps || [], trait, target);
  });

  handle('account:detect', async () => ({ detected: await detectAccount(), accounts: store.get().accounts }));

  handle('account:forget', (riotId) => {
    const accounts = (store.get().accounts || []).filter((a) => a.riotId !== riotId);
    store.set({ accounts });
    return accounts;
  });

  handle('riot:analyze', async ({ count = 20, account = null } = {}, event) => {
    const S = await staticData.load();
    const m = await loadMeta().catch(() => null);
    const n = Math.min(Math.max(Number(count) || 20, 5), 50);
    const acc = await resolveAccount(account);
    const data = await riot.getRecentMatches({ ...store.get(), ...acc }, n, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('riot:progress', p);
    });
    lastAnalysis = analyze({ ...data, S, metaComps: m?.comps || [], stats: await loadEngineStats() });
    cache.write('last_analysis', lastAnalysis);
    return lastAnalysis;
  });

  handle('riot:lastAnalysis', () => {
    if (!lastAnalysis) lastAnalysis = cache.read('last_analysis')?.data || null;
    return lastAnalysis;
  });

  handle('coach:ask', async ({ question, history, includeAnalysis = true, includeLive = false } = {}) => {
    const S = await staticData.load();
    const m = await loadMeta().catch(() => null);
    if (!lastAnalysis) lastAnalysis = cache.read('last_analysis')?.data || null;
    const stats = await loadEngineStats();
    const live = includeLive && liveState.stage
      ? { state: liveState, advice: coachNow({ S, metaComps: m?.comps || [], stats, state: liveState }) }
      : null;
    return coach.ask({
      settings: store.get(), S, meta: m, analysis: includeAnalysis ? lastAnalysis : null,
      engine: engineSummary(), live, question, history,
    });
  });

  handle('coach:now', async (state = {}) => {
    const S = await staticData.load();
    const m = await loadMeta().catch(() => null);
    return coachNow({ S, metaComps: m?.comps || [], stats: await loadEngineStats(), state });
  });

  handle('live:get', () => liveState);
  handle('live:set', (patch = {}, event) => {
    liveState = { ...liveState, ...patch };
    for (const w of [mainWin, overlayWin]) {
      if (w && !w.isDestroyed() && w.webContents !== event.sender) w.webContents.send('live:state', liveState);
    }
    return liveState;
  });

  handle('engine:status', () => ({
    ...(collector ? collector.status() : { running: false, matches: 0 }),
    autoCollect: store.get().engineAutoCollect,
    stats: engineSummary(),
  }));
  handle('ocr:defaults', () => screenReader.DEFAULT_REGIONS);
  handle('ocr:capture', async () => {
    const cap = await screenReader.capture();
    lastCapture = cap.image;
    const preview = cap.image.getSize().width > 1600 ? cap.image.resize({ width: 1600, quality: 'good' }) : cap.image;
    return { dataUrl: preview.toDataURL(), source: cap.source, size: cap.size };
  });
  handle('ocr:test', async (regions) => {
    if (!lastCapture) lastCapture = (await screenReader.capture()).image;
    return screenReader.read(lastCapture, regions || ocrRegions(), await staticData.load());
  });

  handle('engine:rebuild', async () => {
    await rebuildStats();
    return engineSummary();
  });

  handle('gemini:models', () => {
    const key = store.get().geminiApiKey;
    if (!key) throw new Error('Önce Gemini API anahtarını kaydet.');
    return gemini.listModels(key);
  });

  handle('overlay:toggle', () => setOverlayVisible(!(overlayWin && overlayWin.isVisible())));
  handle('overlay:hide', () => setOverlayVisible(false));
  handle('overlay:clickThrough', (on) => setClickThrough(on));
  handle('overlay:pin', (comp) => {
    const pinned = comp && comp.id ? comp : null;
    store.set({ pinnedCompId: pinned?.id || null, pinnedComp: pinned });
    broadcast('comp:pinned', pinned);
    if (pinned) setOverlayVisible(true);
    return pinned?.id || null;
  });

  handle('update:get', () => ({ ...updateState, current: app.getVersion(), packaged: app.isPackaged }));
  handle('update:check', async () => {
    if (!app.isPackaged) throw new Error('Güncelleme kontrolü yalnızca kurulu uygulamada çalışır.');
    await autoUpdater.checkForUpdates();
    return updateState;
  });
  handle('update:install', () => {
    if (updateState.status !== 'ready') throw new Error('İndirilmiş bir güncelleme yok.');
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  });

  handle('shell:open', (url) => openExternal(url));
  handle('clipboard:write', (text) => { clipboard.writeText(String(text || '')); return true; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createMainWindow();
  createOverlay();
  const failed = registerHotkeys();
  if (failed.length) console.warn('Kısayol kaydedilemedi:', failed.join(', '));
  initUpdater();

  liveClient.start((state) => {
    const wasTft = gameState.inGame && gameState.isTft;
    gameState = state;
    broadcast('game:state', state);
    const isTft = state.inGame && state.isTft;
    if (store.get().autoOverlay && isTft !== wasTft) setOverlayVisible(isTft);
    if (isTft && !wasTft) detectAccount().catch(() => {});
    updateOcrLoop();
  });

  staticData.load()
    .then(() => loadMeta())
    .catch((e) => console.error('Ön yükleme hatası:', e.message))
    .then(() => initEngine())
    .catch((e) => console.error('Motor başlatılamadı:', e.message));
});

app.on('second-instance', () => {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  collector?.stop();
  if (ocrTimer) clearInterval(ocrTimer);
  screenReader.shutdown();
  liveClient.stop();
});
