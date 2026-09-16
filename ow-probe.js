// Overwolf (ow-electron) tanı aracı — uygulamayı açar, GEP paketinin yüklenip yüklenmediğini
// yazdırır ve kapanır.
//
// ÖNEMLİ: ow-electron uygulama kökünü GİRİŞ DOSYASININ BULUNDUĞU KLASÖR olarak alır.
// Bu yüzden bu dosya proje kökünde durmalıdır; alt klasöre taşınırsa package.json bulunamaz
// ve `overwolf.packages` okunmadığı için gep paketi hiç yüklenmez.
//
// Çalıştırma (proje kökünden):
//   node node_modules/@overwolf/ow-electron/cli.js ow-probe.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

const WAIT_MS = Number(process.env.OW_PROBE_WAIT || 15000);
const log = (...args) => console.log('[ow-probe]', ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

log('electron:', process.versions.electron, '| app.overwolf:', !!app.overwolf);
log('uygulama kökü:', app.getAppPath(), '| ad:', app.getName());

const packages = app.overwolf?.packages;
if (packages) {
  packages.on('ready', (_e, name, version) => log('paket ready:', name, version));
  packages.on('failed-to-initialize', (_e, name) => log('paket başlatılamadı:', name));
  packages.on('package-update-pending', (_e, name) => log('paket güncellemesi bekliyor:', name));
  packages.on('error', (_e, name, error) => log('paket hatası:', name, String(error)));
} else {
  log('UYARI: app.overwolf.packages yok — normal Electron ile mi çalıştırıldı?');
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') log('renderer error:', e.message);
  });
});

require(path.join(__dirname, 'main.js'));

app.whenReady().then(async () => {
  await sleep(WAIT_MS);
  const main = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'TFT Asistan');
  log('pencere açıldı mı:', !!main);
  if (main) {
    const status = await main.webContents
      .executeJavaScript("window.tft.invoke('gep:status')")
      .catch((e) => ({ err: e.message }));
    log('gep:status =', JSON.stringify(status));
  }
  log('gep paketi yüklendi mi:', !!app.overwolf?.packages?.gep);
  if (app.overwolf?.packages?.gep) {
    try {
      const games = await app.overwolf.packages.gep.getSupportedGames();
      log('desteklenen oyun sayısı:', Array.isArray(games) ? games.length : '?');
      log('TFT destekli mi:', Array.isArray(games) && games.some((g) => Number(g.id) === 21570));
    } catch (e) {
      log('getSupportedGames hatası:', e.message);
    }
  }
  app.exit(0);
});
