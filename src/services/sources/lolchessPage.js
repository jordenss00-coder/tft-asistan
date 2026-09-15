const { fetchText } = require('../http');
const { nextData } = require('./util');

// lolchess'in meta sayfası hem comp kaynağı hem şampiyon detayları için kullanılıyor.
// Sayfa ağır olduğundan tek indirme paylaşılır; eşzamanlı istekler aynı indirmeyi bekler.
const URL = 'https://lolchess.gg/meta';
const MAX_AGE = 10 * 60 * 1000;

let cached = null;
let inflight = null;

async function getQueries() {
  if (cached && Date.now() - cached.at < MAX_AGE) return cached.queries;
  if (inflight) return inflight;
  inflight = (async () => {
    const html = await fetchText(URL, { timeoutMs: 90000, headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
    const queries = nextData(html).props?.pageProps?.dehydratedState?.queries || [];
    cached = { at: Date.now(), queries };
    return queries;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

const query = (queries, name) => queries.find((q) => q.queryKey?.[0] === name)?.state?.data;

module.exports = { getQueries, query, URL };
