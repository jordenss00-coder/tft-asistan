const { makeResolver } = require('./traits');
const { boardPower } = require('./engine/stats');
const { recommendComps } = require('./engine/compRecommender');

const QUEUES = { 1100: 'Dereceli', 1090: 'Normal', 1130: 'Hiper Tempo', 1160: 'Çiftli Mücadele' };
const MAIN_QUEUES = new Set([1100, 1090]);
const RARITY_COST = { 0: 1, 1: 2, 2: 3, 4: 4, 6: 5 };

const avg = (arr) => {
  const v = arr.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const rate = (arr, fn) => (arr.length ? arr.filter(fn).length / arr.length : null);
const num = (v, d = 2) => (v == null ? '–' : v.toFixed(d).replace('.', ','));
const pct = (v) => (v == null ? '–' : `%${Math.round(v * 100)}`);
const prettify = (id) => String(id || '').replace(/^(TFT\d*|DA)_(\d+_)?/i, '').replace(/(Item|Augment)_/g, '').replace(/_/g, ' ').trim();
const isTop4 = (g) => g.placement <= 4;

function stageNum(round) {
  if (!round) return 0;
  return round <= 4 ? 1 : Math.floor((round - 5) / 7) + 2;
}

function stageOf(round) {
  if (!round) return '?';
  if (round <= 4) return `1-${round}`;
  return `${stageNum(round)}-${((round - 5) % 7) + 1}`;
}

function matchComp(unitIds, comps) {
  const set = new Set(unitIds);
  let best = null;
  for (const c of comps) {
    if (!c.units?.length) continue;
    const score = c.units.filter((u) => set.has(u)).length / c.units.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { comp: c, score };
  }
  return best ? { id: best.comp.id, name: best.comp.name, tier: best.comp.tier, score: best.score } : null;
}

function parseGame(m, puuid, comps, res) {
  const info = m?.info;
  const p = info?.participants?.find((x) => x.puuid === puuid);
  if (!p) return null;
  const units = (p.units || []).map((u) => {
    const c = res.unit(u.character_id);
    return {
      apiName: c?.apiName || u.character_id,
      name: c?.name || prettify(u.character_id),
      cost: c?.cost ?? RARITY_COST[u.rarity] ?? 1,
      star: u.tier || 1,
      items: (u.itemNames || []).map((i) => res.item(i)?.apiName || i),
    };
  });
  const traits = (p.traits || [])
    .filter((t) => t.tier_current > 0)
    .map((t) => {
      const td = res.trait(t.name);
      return { apiName: td?.apiName || t.name, name: td?.name || prettify(t.name), icon: td?.icon || null, count: t.num_units, tierIndex: t.tier_current, maxTier: t.tier_total, unique: !!td?.unique };
    })
    .sort((a, b) => b.tierIndex / b.maxTier - a.tierIndex / a.maxTier || b.count - a.count);
  const mainTrait = traits.filter((t) => !t.unique).sort((a, b) => b.count - a.count)[0] || null;

  return {
    matchId: m.metadata?.match_id,
    date: info.game_datetime,
    queue: info.queue_id,
    queueName: QUEUES[info.queue_id] || 'Diğer',
    set: info.tft_set_number,
    placement: p.placement,
    level: p.level,
    lastRound: p.last_round,
    stage: stageOf(p.last_round),
    stageNum: stageNum(p.last_round),
    gold: p.gold_left,
    damage: p.total_damage_to_players,
    units,
    traits,
    mainTrait: mainTrait ? { apiName: mainTrait.apiName, name: mainTrait.name, count: mainTrait.count } : null,
    augments: (p.augments || []).map((a) => ({ id: res.item(a)?.apiName || a, name: res.item(a)?.name || prettify(a) })),
    comp: matchComp(units.map((u) => u.apiName), comps),
    completedItems: units.flatMap((u) => u.items).filter((i) => !/Component/i.test(i)).length,
    threeItemUnits: units.filter((u) => u.items.length >= 3).length,
    highCost2: units.filter((u) => u.cost >= 4 && u.star >= 2).length,
    threeStars: units.filter((u) => u.star >= 3).length,
  };
}

/**
 * Maçı yüksek elo istatistikleriyle karşılaştırır: güçlendirme seçimi, eşya yerleşimi,
 * elenirken board gücü ve o eşya/güçlendirmelere daha uygun comp'lar.
 */
function reviewGame(g, S, stats, metaComps) {
  const out = { augments: [], items: [], board: null, altComps: [], playedTop: false };
  for (const a of g.augments) {
    const st = stats.augments?.[a.id];
    if (!st || st.n < 20) continue;
    out.augments.push({ id: a.id, name: a.name, avg: st.avg, n: st.n, verdict: st.smoothed <= 4.3 ? 'good' : st.smoothed >= 4.7 ? 'bad' : 'ok' });
  }
  for (const u of g.units) {
    const list = stats.unitItems?.[u.apiName];
    if (!list?.length) continue;
    const best = list.find((x) => !u.items.includes(x.item));
    if (!best) continue;
    for (const it of u.items) {
      if (/Component/i.test(it)) continue;
      const st = list.find((x) => x.item === it);
      if (st && st.smoothed - best.smoothed >= 0.35) {
        out.items.push({
          unit: u.apiName, unitName: u.name, item: it, itemName: S.items[it]?.name || it, itemAvg: st.avg,
          better: best.item, betterName: S.items[best.item]?.name || best.item, betterAvg: best.avg,
        });
      }
    }
  }
  if (g.placement >= 5 && g.lastRound && stats.danger) {
    let danger = null;
    for (let k = 0; k <= 3 && danger == null; k++) danger = stats.danger[g.lastRound - k] ?? stats.danger[g.lastRound + k] ?? null;
    if (danger) {
      const power = boardPower(g.units.map((u) => ({ id: u.apiName, star: u.star, items: u.items })), S);
      out.board = { power, danger, ratio: power / danger };
    }
  }
  // Birimler hariç tutulur; soru "bu eşya ve güçlendirmelerle hangi comp daha iyiydi?"
  const rec = recommendComps({
    S, metaComps, stats,
    state: {
      stage: g.stage,
      level: g.level,
      augments: g.augments.map((a) => a.id),
      completed: g.units.flatMap((u) => u.items).filter((i) => !/Component/i.test(i)),
    },
  });
  out.altComps = rec.top.slice(0, 3).map((c) => ({ id: c.id, name: c.name, score: c.score }));
  out.playedTop = !!g.comp && out.altComps.some((c) => c.id === g.comp.id);
  return out;
}

function groupBy(games, keyFn, nameFn, extraFn = () => ({})) {
  const map = new Map();
  for (const g of games) {
    const key = keyFn(g);
    if (key == null) continue;
    const e = map.get(key) || { key, name: nameFn(g), places: [], ...extraFn(g) };
    e.places.push(g.placement);
    map.set(key, e);
  }
  return [...map.values()]
    .map(({ places, ...e }) => ({ ...e, games: places.length, avg: avg(places), top4: rate(places, (x) => x <= 4), win: rate(places, (x) => x === 1) }))
    .sort((a, b) => b.games - a.games || a.avg - b.avg);
}

function buildInsights(games, s, compStats, traitStats) {
  const out = [];
  const add = (type, title, detail) => out.push({ type, title, detail });
  const top = games.filter(isTop4);
  const bot = games.filter((g) => !isTop4(g));

  if (s.avgPlacement <= 3.8) add('good', 'Genel performansın çok iyi', `Ortalama sıran ${num(s.avgPlacement)}, top 4 oranın ${pct(s.top4)}. Mevcut yaklaşımını koru.`);
  else if (s.avgPlacement <= 4.4) add('warn', 'Ortalama civarındasın', `Ortalama sıran ${num(s.avgPlacement)} (lobi ortalaması 4,5). Aşağıdaki maddeler seni yukarı taşır.`);
  else add('bad', 'Sıralaman ortalamanın altında', `Ortalama sıran ${num(s.avgPlacement)}, top 4 oranın ${pct(s.top4)}. Önce istikrarı (top 4) hedefle; 1.lik için gereksiz risk alma.`);

  if (games.length >= 8 && s.top4 >= 0.5 && s.win < 0.12) {
    add('warn', 'Top 4 alıyorsun ama oyunu bitiremiyorsun', `Top 4 oranın ${pct(s.top4)}, 1.lik oranın ise ${pct(s.win)}. Geç oyunda board'u tamamla: seviye 9, 4-5 maliyetleri 2★ ve ana carry'de 3 tamamlanmış eşya.`);
  }
  if (s.bottom2 >= 0.3) {
    add('bad', 'Çok sık 7-8. oluyorsun', `Maçlarının ${pct(s.bottom2)} kadarı 7-8. sırada bitti. Kötü başlangıçta canını korumak için erken roll yap ve comp'u zorlamak yerine elindekine göre esnek ol.`);
  }

  const early = games.filter((g) => g.placement >= 6 && g.stageNum && g.stageNum <= 4);
  if (early.length / games.length >= 0.2) {
    add('bad', 'Erken eleniyorsun', `${early.length} maçta 4. stage bitmeden elendin. Stage 2-3'te eldeki en güçlü board'u sahaya koy, can 50'nin altına inmeden stabilize olmak için roll yap.`);
  }

  const botGold = avg(bot.map((g) => g.gold));
  if (bot.length >= 3 && botGold >= 10) {
    add('bad', 'Elenirken altın bırakıyorsun', `Top 4 dışı maçlarda ortalama ${Math.round(botGold)} altınla elendin. Can kritik seviyedeyken (30 ve altı) altını seviye ve roll'a çevir; elde kalan altın elenince boşa gider.`);
  } else if (bot.length >= 3) {
    add('good', 'Kaynaklarını iyi harcıyorsun', `Kaybettiğin maçlarda bile ortalama ${Math.round(botGold)} altın bıraktın.`);
  }

  const lateBot = bot.filter((g) => g.stageNum >= 5);
  const lvlBot = avg(lateBot.map((g) => g.level));
  const lvlTop = avg(top.map((g) => g.level));
  if (lateBot.length >= 3 && lvlBot < 8) {
    add('warn', 'Seviye atlamada geç kalıyorsun', `Stage 5'e kadar gelip top 4'ü kaçırdığın maçlarda ortalama seviyen ${num(lvlBot, 1)}. 4 maliyetleri bulmak için genelde 4-2'de seviye 8 gerekir.`);
  }
  if (lvlTop != null && lvlBot != null && lvlTop - lvlBot >= 0.8) {
    add('warn', 'Seviye farkı sonucu belirliyor', `Top 4 maçlarında ortalama seviyen ${num(lvlTop, 1)}, diğerlerinde ${num(lvlBot, 1)}. Ekonomini seviye atlamak için daha erken kullan.`);
  }

  const noCarry = rate(games, (g) => g.threeItemUnits === 0);
  if (noCarry >= 0.35) {
    add('warn', 'Eşyaları tek carry\'de toplamıyorsun', `Maçlarının ${pct(noCarry)} kadarında 3 eşyalı birim yok. Eşyaları dağıtmak yerine ana carry'ye 3 tamamlanmış eşya hedefle.`);
  }
  const itemTop = avg(top.map((g) => g.completedItems));
  const itemBot = avg(bot.map((g) => g.completedItems));
  if (itemTop != null && itemBot != null && itemTop - itemBot >= 1.5) {
    add('warn', 'Eşya tamamlama sorunu', `Top 4 maçlarında board'da ortalama ${num(itemTop, 1)}, diğerlerinde ${num(itemBot, 1)} tamamlanmış eşya var. Bileşenleri bekletme, erkenden eşyaya çevir.`);
  }

  const late = bot.filter((g) => g.stageNum >= 5);
  const hcBot = avg(late.map((g) => g.highCost2));
  if (late.length >= 3 && hcBot < 1) {
    add('warn', 'Geç oyun board\'un zayıf kalıyor', `Stage 5'e ulaşıp top 4 dışı kaldığın maçlarda ortalama ${num(hcBot, 1)} adet 2★ 4-5 maliyet birimin vardı. Seviye 8'de roll yapıp ana 4 maliyetleri 2★ yap.`);
  }

  const played = compStats.filter((c) => c.key !== '__off');
  const fav = played[0];
  if (fav && games.length >= 8 && fav.games / games.length >= 0.5) {
    if (fav.avg > 4.3) add('bad', `"${fav.name}" comp'unu zorluyorsun`, `Maçlarının ${pct(fav.games / games.length)} kadarında bu comp'u oynadın ve ortalaman ${num(fav.avg)}. Başlangıç eşyalarına ve güçlendirmelere göre 2-3 comp arasında esnek ol.`);
    else add('good', `"${fav.name}" senin güçlü comp'un`, `${fav.games} maçta ortalama ${num(fav.avg)}. Lobide az oynandığında bu comp'u tercih etmeye devam et.`);
  }
  const off = compStats.find((c) => c.key === '__off');
  if (off && off.games / games.length >= 0.4 && off.avg > 4.5) {
    add('warn', 'Meta dışı board\'lar kötü sonuç veriyor', `Maçlarının ${pct(off.games / games.length)} kadarı bilinen bir meta comp'a benzemiyor ve bu maçlarda ortalaman ${num(off.avg)}. Meta sekmesindeki S/A comp'lardan 2-3 tanesini öğren.`);
  }
  const lowTier = games.filter((g) => g.comp && ['B', 'C'].includes(g.comp.tier));
  if (lowTier.length / games.length >= 0.4) {
    add('warn', 'Zayıf tier comp\'ları sık oynuyorsun', `Maçlarının ${pct(lowTier.length / games.length)} kadarında B/C tier bir comp oynadın. Eşit şartlarda S/A tier alternatifleri tercih et.`);
  }

  const ranked = traitStats.filter((t) => t.games >= 3).sort((a, b) => a.avg - b.avg);
  if (ranked.length) add('good', `En iyi sonuç aldığın trait: ${ranked[0].name}`, `${ranked[0].games} maçta ortalama ${num(ranked[0].avg)}.`);
  const worst = ranked[ranked.length - 1];
  if (ranked.length > 1 && worst.avg >= 5) add('warn', `${worst.name} ile zorlanıyorsun`, `${worst.games} maçta ortalama ${num(worst.avg)}. Bu trait'i ancak güçlü başlangıçla oyna.`);

  const reviewed = games.filter((g) => g.review);
  if (reviewed.length >= 5) {
    const augs = reviewed.flatMap((g) => g.review.augments);
    const badAugs = augs.filter((a) => a.verdict === 'bad');
    if (augs.length >= 6 && badAugs.length / augs.length >= 0.35) {
      const names = [...new Set(badAugs.map((a) => a.name))].slice(0, 3).join(', ');
      add('warn', 'Güçlendirme seçimlerin zayıf kalıyor', `Seçtiğin güçlendirmelerin ${pct(badAugs.length / augs.length)} kadarı yüksek elo'da ortalamanın altında sonuç veriyor (ör. ${names}). Seçim ekranında Canlı Koç'a güçlendirme seçeneklerini girip karşılaştır.`);
    }
    const itemIssues = reviewed.flatMap((g) => g.review.items);
    if (itemIssues.length >= 3) {
      const ex = itemIssues[0];
      add('warn', 'Eşya yerleşimin geliştirilebilir', `${itemIssues.length} kez bir birime yüksek elo'da belirgin şekilde daha zayıf sonuç veren bir eşya verdin. Örnek: ${ex.unitName}'da ${ex.itemName} (ort. ${num(ex.itemAvg)}) yerine ${ex.betterName} (ort. ${num(ex.betterAvg)}).`);
    }
    const boards = reviewed.filter((g) => g.review.board);
    if (boards.length >= 3) {
      const ratio = avg(boards.map((g) => g.review.board.ratio));
      if (ratio < 0.9) add('bad', 'Zayıf board ile eleniyorsun', `Top 4 dışı maçlarda elendiğin turdaki board gücün, aynı turda elenen yüksek elo oyuncularının medyanının ortalama ${pct(ratio)} kadardı. Board'u daha erken güçlendir, can kaybını azalt.`);
    }
    const missed = reviewed.filter((g) => g.comp && !g.review.playedTop && !isTop4(g));
    if (missed.length >= 3) {
      add('warn', 'Eşya ve güçlendirmelerine daha uygun comp\'lar vardı', `${missed.length} kaybedilen maçta, elindeki eşya ve güçlendirmelere göre motorun ilk 3 önerisi dışında bir comp oynadın. Maç geçmişinde her maç için önerilen alternatifleri görebilirsin.`);
    }
  }

  const order = { bad: 0, warn: 1, good: 2 };
  return out.sort((a, b) => order[a.type] - order[b.type]);
}

function coachSummary(r) {
  const s = r.summary;
  const L = [];
  L.push(`Hesap: ${r.account.gameName}#${r.account.tagLine}${r.rank ? ` · ${r.rank.tier} ${r.rank.rank} ${r.rank.leaguePoints} LP (${r.rank.wins}G/${r.rank.losses}M)` : ''}`);
  L.push(`Son ${s.games} maç: ort. sıra ${num(s.avgPlacement)}, top 4 ${pct(s.top4)}, 1.lik ${pct(s.win)}, 7-8. ${pct(s.bottom2)}, ort. seviye ${num(s.avgLevel, 1)}, ort. oyuncu hasarı ${Math.round(s.avgDamage || 0)}, top 4 dışı maçlarda elenirken ort. altın ${s.avgGoldLeftBottom == null ? '–' : Math.round(s.avgGoldLeftBottom)}`);
  L.push(`Sıra dağılımı: ${s.dist.map((n, i) => `${i + 1}.:${n}`).join(' ')}`);
  L.push(`Comp performansı: ${r.compStats.slice(0, 6).map((c) => `${c.name} (${c.games} maç, ort ${num(c.avg)})`).join('; ')}`);
  L.push(`Ana trait performansı: ${r.traitStats.slice(0, 6).map((t) => `${t.name} (${t.games} maç, ort ${num(t.avg)})`).join('; ')}`);
  if (r.augmentStats.length) L.push(`Güçlendirmeler: ${r.augmentStats.slice(0, 8).map((a) => `${a.name} (${a.games}, ort ${num(a.avg)})`).join('; ')}`);
  L.push('Otomatik tespitler:');
  for (const i of r.insights) L.push(`- [${i.type}] ${i.title}: ${i.detail}`);
  L.push('Son 10 maç:');
  for (const g of r.games.slice(0, 10)) {
    const rv = g.review;
    const reviewText = rv
      ? ` | zayıf güçlendirmeler: ${rv.augments.filter((a) => a.verdict === 'bad').map((a) => a.name).join(', ') || '-'} | eşya hataları: ${rv.items.map((x) => `${x.unitName}: ${x.itemName}→${x.betterName}`).join(', ') || '-'} | uygun comp'lar: ${rv.altComps.map((c) => c.name).join(', ')}${rv.board ? ` | board gücü ${rv.board.power}/${Math.round(rv.board.danger)}` : ''}`
      : '';
    L.push(`- #${g.placement} | ${g.comp?.name || g.mainTrait?.name || 'karışık'} | sv ${g.level} | elendiği tur ${g.stage} | kalan altın ${g.gold} | 3 eşyalı birim ${g.threeItemUnits} | ${g.units.map((u) => `${u.name}${'★'.repeat(u.star)}`).join(', ')}${reviewText}`);
  }
  return L.join('\n');
}

function analyze({ matches, account, rank, S, metaComps, stats = null }) {
  const res = { unit: makeResolver(S.champById), item: makeResolver(S.items), trait: makeResolver(S.traitsById) };
  const all = matches.map((m) => parseGame(m, account.puuid, metaComps, res)).filter(Boolean);
  let games = all.filter((g) => g.set === S.setNumber);
  if (!games.length) games = all;
  const main = games.filter((g) => MAIN_QUEUES.has(g.queue));
  if (main.length >= 3) games = main;
  games.sort((a, b) => b.date - a.date);
  if (!games.length) throw new Error('Analiz edilecek uygun maç bulunamadı.');
  if (stats?.matches) for (const g of games) g.review = reviewGame(g, S, stats, metaComps);

  const bot = games.filter((g) => !isTop4(g));
  const summary = {
    games: games.length,
    excluded: all.length - games.length,
    avgPlacement: avg(games.map((g) => g.placement)),
    top4: rate(games, isTop4),
    win: rate(games, (g) => g.placement === 1),
    bottom2: rate(games, (g) => g.placement >= 7),
    dist: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => games.filter((g) => g.placement === i).length),
    avgLevel: avg(games.map((g) => g.level)),
    avgDamage: avg(games.map((g) => g.damage)),
    avgGoldLeftBottom: avg(bot.map((g) => g.gold)),
  };

  const compStats = groupBy(games, (g) => g.comp?.id || '__off', (g) => g.comp?.name || 'Meta dışı / karışık', (g) => ({ tier: g.comp?.tier || null }));
  const traitStats = groupBy(games, (g) => g.mainTrait?.apiName, (g) => g.mainTrait?.name);

  const augMap = new Map();
  for (const g of games) {
    for (const a of g.augments) {
      const e = augMap.get(a.id) || { id: a.id, name: a.name, places: [] };
      e.places.push(g.placement);
      augMap.set(a.id, e);
    }
  }
  const augmentStats = [...augMap.values()]
    .map(({ places, ...e }) => ({ ...e, games: places.length, avg: avg(places) }))
    .filter((a) => a.games >= 2)
    .sort((a, b) => b.games - a.games || a.avg - b.avg)
    .slice(0, 12);

  const result = { analyzedAt: Date.now(), account, rank, summary, compStats, traitStats, augmentStats, games };
  result.insights = buildInsights(games, summary, compStats, traitStats);
  result.coachSummary = coachSummary(result);
  return result;
}

module.exports = { analyze };
