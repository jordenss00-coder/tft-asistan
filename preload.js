const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'settings:get', 'settings:set', 'static:get', 'meta:get', 'meta:sources', 'planner:plan',
  'riot:analyze', 'riot:lastAnalysis', 'account:detect', 'account:forget', 'coach:ask', 'gemini:models',
  'overlay:toggle', 'overlay:hide', 'overlay:clickThrough', 'overlay:pin',
  'shell:open', 'clipboard:write', 'update:get', 'update:check', 'update:install',
  'coach:now', 'live:get', 'live:set', 'engine:status', 'engine:rebuild',
  'ocr:defaults', 'ocr:capture', 'ocr:test', 'ocr:now', 'stats:units', 'champs:details',
]);
const EVENTS = new Set([
  'update:status', 'engine:status', 'engine:stats', 'live:state', 'ocr:reading', 'app:error',
  'settings:changed', 'comp:pinned', 'game:state', 'overlay:visible', 'overlay:clickThrough', 'riot:progress', 'meta:updated',
]);

contextBridge.exposeInMainWorld('tft', {
  invoke: (channel, payload) => (INVOKE.has(channel)
    ? ipcRenderer.invoke(channel, payload)
    : Promise.reject(new Error(`İzin verilmeyen kanal: ${channel}`))),
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) return () => {};
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
