const { fetchText } = require('../http');
const { normId } = require('../traits');
const { htmlDecode } = require('./util');

const URL = 'https://tftflow.com/tier-list';

function econLabel(econ) {
  const e = htmlDecode(econ || '').trim();
  if (/^[\d½]+$/.test(e)) return `${e} maliyet reroll`;
  return e;
}

module.exports = {
  id: 'tftflow',
  name: 'TFT Flow',
  kind: 'guide',
  url: URL,
  maxAge: 3 * 60 * 60 * 1000,
  async fetch(S) {
    const html = await fetchText(URL, { timeoutMs: 45000 });
    const champNorms = S.champions.map((c) => ({ id: c.apiName, n: normId(c.apiName) }));
    const re = /<div class="comp-card-wrapper" data-comp-id="(\d+)"([^>]*)>([\s\S]*?)(?=<div class="comp-card-wrapper"|$)/g;
    const seen = new Set();
    const entries = [];
    let m;
    while ((m = re.exec(html))) {
      const [, id, attrs, body] = m;
      if (seen.has(id)) continue;
      seen.add(id);
      const pick = (r) => (body.match(r) || attrs.match(r) || [])[1] || null;
      const name = htmlDecode(pick(/tier-comp-name">([^<]+)</));
      const tier = pick(/data-current-base-tier="([^"]+)"/);
      if (!name || !tier) continue;
      const slug = (pick(/squareIcon\/([a-z0-9_]+?)_teamplanner/) || '').replace(/^t_\d+_/, '').replace(/_/g, '');
      const main = slug ? champNorms.find((c) => c.n === slug) || champNorms.find((c) => c.n.startsWith(slug)) : null;
      entries.push({
        id: `tftflow:${id}`,
        name,
        tier,
        maxTier: pick(/data-current-max-tier="([^"]+)"/),
        levelling: econLabel(pick(/econ-badge[^"]*">([^<]+)</)),
        mainChampion: main?.id || null,
        units: [],
        url: pick(/href="(https:\/\/tftflow\.com\/composition\/[^"]+)"/) || URL,
      });
    }
    if (!entries.length) throw new Error('Tier listesi okunamadı (site yapısı değişmiş olabilir).');
    return entries;
  },
};
