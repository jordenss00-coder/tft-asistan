const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { DEFAULT_MODEL } = require('./gemini');

const SECRETS = ['riotApiKey', 'geminiApiKey'];
const DEFAULTS = {
  riotId: '',
  platform: 'tr1',
  accountMode: 'auto',
  accounts: [],
  riotApiKey: '',
  geminiApiKey: '',
  geminiModel: DEFAULT_MODEL,
  overlayHotkey: 'Alt+T',
  clickThroughHotkey: 'Alt+Y',
  autoOverlay: true,
  overlayOpacity: 0.92,
  overlayBounds: null,
  pinnedCompId: null,
  pinnedComp: null,
  disabledSources: [],
  engineAutoCollect: true,
  ocrEnabled: false,
  ocrRegions: null,
};

let state = null;
// Şifresi çözülemeyen anahtarlar (ör. uygulama farklı bir klasöre kurulduysa) silinmez, korunur.
const unreadable = new Set();
const rawEncrypted = {};

const file = () => path.join(app.getPath('userData'), 'settings.json');

function decrypt(v) {
  try {
    return safeStorage.decryptString(Buffer.from(v, 'base64'));
  } catch {
    return '';
  }
}

function load() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch { /* ilk çalıştırma */ }
  const s = { ...DEFAULTS };
  for (const [k, v] of Object.entries(raw)) if (k in DEFAULTS) s[k] = v;
  for (const k of SECRETS) {
    if (!raw[`${k}__enc`]) continue;
    rawEncrypted[k] = raw[`${k}__enc`];
    s[k] = decrypt(raw[`${k}__enc`]);
    if (!s[k]) unreadable.add(k);
  }
  return s;
}

function persist() {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (!SECRETS.includes(k)) { out[k] = v; continue; }
    if (!v) {
      if (unreadable.has(k) && rawEncrypted[k]) out[`${k}__enc`] = rawEncrypted[k];
      continue;
    }
    // API anahtarları Windows DPAPI ile şifrelenerek saklanır.
    if (safeStorage.isEncryptionAvailable()) out[`${k}__enc`] = safeStorage.encryptString(v).toString('base64');
    else out[k] = v;
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(out, null, 2));
}

function get() {
  if (!state) state = load();
  return state;
}

function set(partial) {
  get();
  // Yeni değer girilen ya da açıkça silinen anahtar artık "okunamayan" sayılmaz.
  for (const k of SECRETS) if (partial[k] !== undefined) { unreadable.delete(k); delete rawEncrypted[k]; }
  state = { ...state, ...partial };
  persist();
  return state;
}

function getPublic() {
  const { riotApiKey, geminiApiKey, overlayBounds, ...rest } = get();
  return {
    ...rest,
    hasRiotKey: !!riotApiKey,
    hasGeminiKey: !!geminiApiKey,
    riotKeyUnreadable: unreadable.has('riotApiKey'),
    geminiKeyUnreadable: unreadable.has('geminiApiKey'),
  };
}

module.exports = { get, set, getPublic };
