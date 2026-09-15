const gemini = require('./gemini');
const { plan } = require('./planner');

const SYSTEM = `Sen "TFT Asistan" uygulamasının içindeki, Challenger seviyesinde deneyimli bir Teamfight Tactics koçusun.
Kurallar:
- Her zaman Türkçe yaz. Şampiyon, trait ve eşya adlarını bağlamda verilen Türkçe oyun içi adlarıyla kullan.
- Yalnızca bağlamdaki güncel set verisine, birden fazla siteden derlenmiş meta verisine ve oyuncunun maç verisine dayan. Bağlamda olmayan bir şeyi uydurma; emin değilsen açıkça söyle.
- Önceki setlerden kalma şampiyon, trait veya mekanikleri kullanma.
- Önce net cevabı ver, sonra gerekçesini açıkla. Kısa ve maddeli yaz, gereksiz giriş cümlesi kurma.
- Bir comp anlatırken şu başlıkları kullan: Erken oyun, Orta oyun, Final board, Eşyalar, Seviye/altın planı, Ne zaman oynanır / ne zaman bırakılır.
- Kaynaklar arasında tier farkı varsa bunu belirt.
- Oyuncu analizinde en fazla 5 öncelikli gelişim önerisi ver ve her birini verideki somut bir sayıya bağla.
- "Kendi istatistik motorumuz" bölümü varsa (yüksek elo maçlarından hesaplanan veriler), site verileriyle çeliştiğinde ona öncelik ver ve bunu belirt.
- "Oyuncunun şu anki oyun durumu" bölümü varsa, cevabını o duruma göre ver: somut ekonomi/seviye kararı, en uygun 2-3 comp ve eşya kararları. Kararı oyuncuya bırak; seçenekleri gerekçeleriyle sun.
- Rakip oyuncuların anlık durumu hakkında tahmin yürütme (Riot kuralları gereği).`;

const trLower = (s) => String(s || '').toLocaleLowerCase('tr');
const fmt = (v, d = 2) => (v == null ? '–' : v.toFixed(d));

function unitName(S, id) {
  return S.champById[id]?.name || id;
}

function itemName(S, id) {
  return S.items[id]?.name || String(id).replace(/^(DA|TFT\d*)_(Item_)?/, '');
}

function detectPlan(S, meta, question) {
  const lower = trLower(question);
  const num = lower.match(/\b(\d{1,2})\b/);
  if (!num) return null;
  const n = Number(num[1]);
  if (n < 2 || n > 15) return null;
  const trait = [...S.traits]
    .filter((t) => !t.unique)
    .sort((a, b) => b.name.length - a.name.length)
    .find((t) => lower.includes(trLower(t.name)));
  if (!trait) return null;
  try {
    return plan(S, meta?.comps || [], trait.apiName, n);
  } catch {
    return null;
  }
}

function planText(p, S) {
  return [
    `Hedef: ${p.target} ${p.trait.name}`,
    `Bu trait'e sahip şampiyonlar (${p.available}): ${p.traitUnits.map((u) => `${unitName(S, u)}[${S.champById[u]?.cost}]`).join(', ')}`,
    `Gereken amblem: ${p.emblemsNeeded}${p.emblem ? ` (${p.emblem.name} = ${p.emblem.from.length ? p.emblem.from.map((i) => itemName(S, i)).join(' + ') : 'eşyayla yapılamaz'})` : ''}`,
    `Gereken birim alanı: ${p.slotsNeeded}, önerilen seviye: ${p.recommendedLevel}, seviye 10 üstü ek slot ihtiyacı: ${p.extraSlots}`,
    `Önerilen final board: ${p.board.units.map((u) => unitName(S, u)).join(', ')} | amblem taşıyıcılar: ${p.board.emblemCarriers.map((u) => unitName(S, u)).join(', ') || '-'}`,
    `Aktif trait'ler: ${p.board.traits.filter((t) => t.tierIndex > 0).map((t) => `${t.count} ${t.name}`).join(', ')}`,
    `Aşamalar: ${p.milestones.map((m) => `${m.count} (${m.units.map((u) => unitName(S, u)).join(', ')}${m.emblems ? ` +${m.emblems} amblem` : ''}, ~seviye ${m.level})`).join(' → ')}`,
    `Bu trait'i içeren meta comp'lar: ${p.relatedComps.map((c) => `${c.name} [${c.tier}]`).join('; ') || 'yok'}`,
    `Takım slotu artıran güçlendirmeler: ${p.teamSizeAugments.map((a) => itemName(S, a)).join(', ') || '-'}`,
    `Uyarılar: ${p.warnings.join(' ') || '-'}`,
  ].join('\n');
}

function compLine(c, S) {
  const carries = c.carries.map((x) => `${unitName(S, x.unit)} (${x.items.map((i) => itemName(S, i)).join(', ')})`).join('; ');
  const srcTiers = c.sources.map((s) => `${s.name}${s.tier ? ` ${s.tier}` : ''}`).join(', ');
  const stats = c.stats.map((s) => `${s.source}: ort ${fmt(s.avg)}, top4 %${Math.round((s.top4 || 0) * 100)}`).join(' / ');
  return `- [${c.tier}] ${c.name}${c.altNames.length ? ` (diğer adları: ${c.altNames.slice(0, 3).join(', ')})` : ''} | ${c.levelling || '?'} | kaynaklar: ${srcTiers}${stats ? ` | ${stats}` : ''} | birimler: ${c.units.map((u) => unitName(S, u)).join(', ') || 'bilinmiyor'}${carries ? ` | carry: ${carries}` : ''}${c.stars.length ? ` | 3★ hedef: ${c.stars.map((u) => unitName(S, u)).join(', ')}` : ''}`;
}

function relevantGuides(meta, S, question) {
  const q = trLower(question);
  return (meta?.comps || [])
    .filter((c) => c.guide?.tips?.length)
    .map((c) => {
      let score = 0;
      for (const n of [c.name, ...c.altNames]) for (const w of trLower(n).split(/\s+/)) if (w.length >= 4 && q.includes(w)) score += 1;
      for (const u of c.units) if (q.includes(trLower(unitName(S, u)))) score += 0.5;
      return { c, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ c }) => {
      const g = c.guide;
      return [
        `### ${c.name} rehberi (TFT Academy)`,
        g.early?.length ? `Erken board: ${g.early.map((u) => unitName(S, u)).join(', ')}` : '',
        ...g.tips.map((t) => `${t.stage}: ${t.tip}`),
        g.augmentsTip ? `Güçlendirme notu: ${g.augmentsTip}` : '',
        c.augments.length ? `Önerilen güçlendirmeler: ${c.augments.map((a) => itemName(S, a)).join(', ')}` : '',
      ].filter(Boolean).join('\n');
    });
}

function liveText(live, S) {
  const st = live.state;
  const a = live.advice;
  const L = [
    `Stage ${st.stage}, seviye ${st.level}, altın ${st.gold}, can ${st.hp}, seri ${st.streak}`,
    `Bileşenler: ${(st.components || []).map((i) => itemName(S, i)).join(', ') || '-'}`,
    `Tamamlanmış eşyalar: ${(st.completed || []).map((i) => itemName(S, i)).join(', ') || '-'}`,
    `Güçlendirmeler: ${(st.augments || []).map((i) => itemName(S, i)).join(', ') || '-'}`,
    `Birimler: ${(st.units || []).map((u) => `${unitName(S, u.id)}${'★'.repeat(u.star || 1)}`).join(', ') || '-'}`,
    `Ekonomi motoru önerisi: ${a.econ.primary.title} — ${a.econ.primary.detail} | alternatifler: ${a.econ.alternatives.map((x) => x.title).join('; ')}`,
    `Comp motoru (uygunluk puanı): ${a.comps.top.slice(0, 3).map((c) => `${c.name} ${c.score} (${c.reasons.slice(0, 2).join('; ')})`).join(' | ')}`,
    `Eşya motoru: ${a.items.crafts.map((c) => `${itemName(S, c.item)}${c.holder ? ` → ${unitName(S, c.holder)}` : ''}`).join(', ') || 'yapılacak eşya yok'}${a.items.hold.length ? ` | beklet: ${a.items.hold.map((i) => itemName(S, i)).join(', ')}` : ''}`,
  ];
  if (a.board) L.push(`Board kontrolü: ${a.board.text}`);
  return L.join('\n');
}

function buildContext({ S, meta, analysis, planResult, question, engine = null, live = null }) {
  const L = [`# Set ${S.setNumber} verisi`, '## Trait\'ler — kademeler: şampiyon[maliyet]'];
  for (const t of S.traits) {
    const seen = new Set();
    const units = S.champions.filter((c) => c.traits.includes(t.apiName) && !seen.has(c.baseName) && seen.add(c.baseName));
    const emblem = t.emblem ? ` | amblem: ${t.emblem.from.length ? t.emblem.from.map((i) => itemName(S, i)).join(' + ') : 'yapılamaz'}` : '';
    L.push(`- ${t.name} (${t.breakpoints.join('/')})${emblem}: ${units.map((c) => `${c.name}[${c.cost}]`).join(', ')}`);
  }
  L.push('## Eşya tarifleri');
  L.push(Object.entries(S.recipes).map(([k, id]) => `${itemName(S, id)} = ${k.split('|').map((i) => itemName(S, i)).join(' + ')}`).join('; '));

  if (meta?.comps?.length) {
    const ok = meta.sources.filter((s) => s.ok).map((s) => s.name);
    L.push(`## Meta comp'lar (${ok.join(', ')} kaynaklarının birleşimi; tier = kaynak ortalaması)`);
    for (const c of meta.comps.filter((x) => x.units.length).slice(0, 25)) L.push(compLine(c, S));
    L.push(...relevantGuides(meta, S, question));
  }
  if (engine?.matches) {
    L.push(`## Kendi istatistik motorumuz (${engine.matches} yüksek elo maçı, yama ${engine.patches.join('/')})`);
    for (const c of engine.comps) L.push(`- ${c.name}: ${c.n} oyun, ort. sıra ${fmt(c.avg)}, top4 %${Math.round((c.top4 || 0) * 100)}`);
    if (engine.augments.length) L.push(`En iyi sonuç veren güçlendirmeler: ${engine.augments.map((a) => `${itemName(S, a.id)} (ort ${fmt(a.avg)})`).join(', ')}`);
  }
  if (live) L.push('## Oyuncunun şu anki oyun durumu', liveText(live, S));
  if (planResult) L.push('## Trait planlayıcı sonucu', planText(planResult, S));
  if (analysis?.coachSummary) L.push('## Oyuncunun son maç analizi', analysis.coachSummary);
  return L.join('\n');
}

async function ask({ settings, S, meta, analysis, question, history = [], engine = null, live = null }) {
  if (!settings.geminiApiKey) {
    throw new Error('Gemini API anahtarı eksik. Ayarlar sayfasından ekle (aistudio.google.com/apikey adresinden alınabilir).');
  }
  const q = String(question || '').trim();
  if (!q) throw new Error('Soru boş olamaz.');

  const planResult = detectPlan(S, meta, q);
  const context = buildContext({ S, meta, analysis, planResult, question: q, engine, live });
  const contents = [
    { role: 'user', parts: [{ text: `BAĞLAM (güncel veriler):\n${context}` }] },
    { role: 'model', parts: [{ text: 'Bağlamı aldım. Sorunu bekliyorum.' }] },
  ];
  for (const h of history.slice(-10)) {
    if (h?.text && (h.role === 'user' || h.role === 'model')) contents.push({ role: h.role, parts: [{ text: String(h.text).slice(0, 4000) }] });
  }
  contents.push({ role: 'user', parts: [{ text: q }] });

  const r = await gemini.generate({ apiKey: settings.geminiApiKey, model: settings.geminiModel, system: SYSTEM, contents });
  return {
    text: r.text,
    usage: r.usage,
    model: settings.geminiModel,
    usedPlan: planResult ? `${planResult.target} ${planResult.trait.name}` : null,
    usedAnalysis: !!analysis,
  };
}

module.exports = { ask };
