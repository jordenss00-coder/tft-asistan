const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function request(url, { headers = {}, timeoutMs = 20000 } = {}, parse) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { ...BROWSER_HEADERS, ...headers }, signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.headers = res.headers;
      throw err;
    }
    return await parse(res);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`İstek zaman aşımına uğradı (${new URL(url).host}).`);
    if (!e.status && e.cause) throw new Error(`Bağlantı kurulamadı (${new URL(url).host}).`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const fetchJson = (url, opts) => request(url, { ...opts, headers: { Accept: 'application/json', ...opts?.headers } }, (r) => r.json());
const fetchText = (url, opts) => request(url, { ...opts, headers: { Accept: 'text/html,*/*', ...opts?.headers } }, (r) => r.text());

module.exports = { fetchJson, fetchText };
