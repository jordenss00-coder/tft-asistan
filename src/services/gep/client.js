const {
  TFT_GAME_ID, REQUIRED_FEATURES, emptyState, applyInfo, applySnapshot, toLive, isUsable,
} = require('./tftState');

// Overwolf paket yaşam döngüsü. Overwolf çalışma zamanı yoksa (normal Electron) sessizce devre dışı kalır;
// uygulamanın geri kalanı etkilenmez. Olay dinleyicileri yalnızca bir kez kaydedilir.

const MODES = {
  unavailable: 'Overwolf çalışma zamanı yok; canlı veri kapalı.',
  waitingPackage: 'Overwolf paketleri bekleniyor…',
  waitingGame: 'TFT açılması bekleniyor.',
  connected: 'TFT bulundu, veri bekleniyor…',
  live: 'Canlı veri akıyor.',
  needsElevation: 'Oyun yönetici olarak çalışıyor; uygulamayı da yönetici olarak başlat.',
  error: 'Canlı veri hatası.',
};

function createGepClient({ overwolf, getStatic, onLive = () => {}, onStatus = () => {}, logger = console } = {}) {
  let state = emptyState();
  let status = { mode: 'unavailable', message: MODES.unavailable, at: Date.now(), gameId: null, features: null, error: null, lastDataAt: null };
  let started = false;
  let gepBound = false;
  let session = 0;
  const enabledGames = new Set();
  const cleanups = [];

  const setStatus = (patch) => {
    status = { ...status, ...patch, at: Date.now() };
    onStatus(status);
    return status;
  };

  const pushLive = () => {
    const S = getStatic?.();
    if (!S) return;
    onLive(toLive(state, S), { usable: isUsable(state), status });
  };

  const resetState = (keepIdentity = true) => {
    const fresh = emptyState();
    if (keepIdentity) {
      fresh.summonerName = state.summonerName;
      fresh.tagLine = state.tagLine;
    }
    state = fresh;
    session++;
    pushLive();
  };

  function handleUpdate(data) {
    const S = getStatic?.();
    if (!S || !data) return;
    const before = state;
    state = applyInfo(state, data, S);
    if (state !== before) {
      setStatus({ mode: 'live', message: MODES.live, lastDataAt: Date.now(), error: null });
      pushLive();
    }
  }

  async function enableGame(gep, gameId) {
    if (enabledGames.has(gameId)) return;
    enabledGames.add(gameId);
    const mySession = ++session;
    try {
      let features = REQUIRED_FEATURES;
      try {
        const supported = await gep.getFeatures(gameId);
        if (Array.isArray(supported) && supported.length) {
          features = REQUIRED_FEATURES.filter((f) => supported.includes(f));
          const missing = REQUIRED_FEATURES.filter((f) => !supported.includes(f));
          if (missing.length) logger.warn?.('GEP eksik özellikler:', missing.join(', '));
        }
      } catch { /* getFeatures desteklenmiyorsa varsayılan listeyi kullan */ }
      await gep.setRequiredFeatures(gameId, features);
      setStatus({ mode: 'connected', message: MODES.connected, gameId, features, error: null });
      const info = await gep.getInfo(gameId).catch(() => null);
      // Geciken anlık görüntü, daha yeni maç verisini ezmemeli.
      if (info && mySession === session) {
        const S = getStatic?.();
        if (S) {
          state = applySnapshot(state, info, S);
          pushLive();
        }
      }
    } catch (e) {
      setStatus({ mode: 'error', message: MODES.error, error: e.message });
    }
  }

  function bindGep(gep) {
    if (gepBound || !gep) return;
    gepBound = true;

    const add = (event, fn) => {
      gep.on(event, fn);
      cleanups.push(() => gep.removeListener?.(event, fn));
    };

    add('game-detected', (event, gameId, name) => {
      if (Number(gameId) !== TFT_GAME_ID) return; // LoL ve diğer oyunlar yok sayılır
      try { event?.enable?.(); } catch (e) { logger.warn?.('GEP enable hatası:', e.message); }
      enableGame(gep, Number(gameId));
    });
    add('new-info-update', (_event, gameId, data) => handleUpdate({ ...data, gameId: data?.gameId ?? gameId }));
    add('new-game-event', (_event, gameId, data) => handleUpdate({ ...data, gameId: data?.gameId ?? gameId }));
    add('game-exit', (_event, gameId) => {
      if (Number(gameId) !== TFT_GAME_ID) return;
      enabledGames.delete(Number(gameId));
      resetState(false);
      setStatus({ mode: 'waitingGame', message: MODES.waitingGame, gameId: null, lastDataAt: null });
    });
    add('elevated-privileges-required', (_event, gameId) => {
      if (Number(gameId) !== TFT_GAME_ID) return;
      setStatus({ mode: 'needsElevation', message: MODES.needsElevation });
    });
    add('error', (_event, gameId, error) => {
      setStatus({ mode: 'error', message: MODES.error, error: String(error) });
    });

    setStatus({ mode: 'waitingGame', message: MODES.waitingGame });
  }

  function start() {
    if (started) return status;
    started = true;
    const packages = overwolf?.packages;
    if (!packages) return setStatus({ mode: 'unavailable', message: MODES.unavailable });

    setStatus({ mode: 'waitingPackage', message: MODES.waitingPackage });
    const onReady = (_event, name) => {
      if (name !== 'gep') return;
      bindGep(packages.gep);
    };
    packages.on('ready', onReady);
    cleanups.push(() => packages.removeListener?.('ready', onReady));
    // Paket zaten yüklüyse ready olayı gelmeyebilir.
    if (packages.gep) bindGep(packages.gep);
    return status;
  }

  function stop() {
    while (cleanups.length) {
      try { cleanups.pop()(); } catch { /* dinleyici zaten kaldırılmış */ }
    }
    started = false;
    gepBound = false;
    enabledGames.clear();
    resetState(false);
    setStatus({ mode: 'unavailable', message: MODES.unavailable, gameId: null });
  }

  return {
    start,
    stop,
    getStatus: () => status,
    getState: () => state,
    getLive: () => toLive(state, getStatic?.() || { items: {} }),
    isUsable: () => isUsable(state),
    /** Testler ve elle tetikleme için */
    _applyUpdate: handleUpdate,
  };
}

module.exports = { createGepClient, MODES };
