const { fetchText } = require('../http');
const teamCode = require('../teamCode');
const { htmlDecode } = require('./util');

const URL = 'https://bunnymuffins.lol/meta/';

function parseTierMap(html) {
  const map = {};
  const block = html.match(/<p[^>]*>\s*S:\s*<a[\s\S]*?<\/p>/);
  if (!block) return map;
  for (const seg of block[0].split(/<br\s*\/?>/i)) {
    const t = seg.replace(/<[^>]+>/g, '').trim().match(/^(S\+?|A|B|C)\s*:/);
    if (!t) continue;
    for (const a of seg.matchAll(/href="#([^"]+)"/g)) map[a[1]] = t[1];
  }
  return map;
}

module.exports = {
  id: 'bunnymuffins',
  name: 'BunnyMuffins',
  kind: 'guide',
  url: URL,
  maxAge: 3 * 60 * 60 * 1000,
  async fetch(S) {
    const html = await fetchText(URL, { timeoutMs: 45000 });
    const tiers = parseTierMap(html);
    const heads = [...html.matchAll(/<h3[^>]*id="([^"]+)"[^>]*>([^<]+)<\/h3>/g)];
    const entries = heads.map((h, i) => {
      const section = html.slice(h.index, heads[i + 1]?.index ?? html.length);
      const code = (section.match(/data-copy="(02[0-9a-f]{30}TFTSet\d+)"/i) || [])[1] || null;
      const units = code ? teamCode.decode(code, S) : [];
      const levelling = htmlDecode((section.match(/<summary>([^<]+)<\/summary>/) || [])[1] || '').trim();
      return {
        id: `bunnymuffins:${h[1]}`,
        name: htmlDecode(h[2]).trim(),
        tier: tiers[h[1]] || null,
        units,
        levelling,
        teamCode: code,
        url: `${URL}#${h[1]}`,
      };
    }).filter((e) => e.tier || e.units.length >= 5);
    if (!entries.length) throw new Error('Comp listesi okunamadı (site yapısı değişmiş olabilir).');
    return entries;
  },
};
