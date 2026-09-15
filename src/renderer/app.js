'use strict';

const state = {
  S: null,
  meta: null,
  metaLoading: false,
  settings: null,
  sourceList: null,
  analysis: null,
  analyzing: false,
  anCount: 20,
  anAccount: '',
  detected: null,
  detecting: false,
  detectTried: false,
  view: 'meta',
  metaFilter: { q: '', style: '', minSources: 1 },
  openDetails: new Set(),
  plannerSel: null,
  plannerResult: null,
  chat: [],
  chatBusy: false,
  includeAnalysis: true,
  includeLive: false,
  engine: null,
  liveCtx: null,
};

const VIEWS = {
  meta: renderMeta,
  live: renderLive,
  planner: renderPlanner,
  analysis: renderAnalysis,
  coach: renderCoach,
  items: renderItems,
  settings: renderSettings,
};

document.addEventListener('DOMContentLoaded', () => {
  bindShell();
  boot();
});

function bindShell() {
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b && state.S) show(b.dataset.view);
  });
  $('#overlayToggle').addEventListener('click', () => {
    call('overlay:toggle').then(updateOverlayButton).catch((e) => toast(e.message, 'bad'));
  });
  window.tft.on('game:state', (s) => {
    if (!state.settings) return;
    state.settings.gameState = s;
    updateSidebar();
  });
  window.tft.on('overlay:visible', updateOverlayButton);
  window.tft.on('settings:changed', (pub) => {
    state.settings = { ...state.settings, ...pub };
    updateSidebar();
  });
  window.tft.on('comp:pinned', (comp) => {
    if (!state.settings) return;
    state.settings.pinnedCompId = comp?.id || null;
    if (state.view === 'meta') renderCompList();
  });
  window.tft.on('update:status', renderUpdate);
  window.tft.on('engine:status', (s) => {
    state.engine = { ...state.engine, ...s };
    renderEngineStatus();
  });
  window.tft.on('engine:stats', (summary) => {
    state.engine = { ...state.engine, stats: summary };
    renderEngineStatus();
  });
  call('update:get').then((u) => {
    state.version = u.current;
    renderUpdate(u);
  }).catch(() => {});
  $('#updateBox').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="update-install"]')) call('update:install').catch((err) => toast(err.message, 'bad'));
  });
  window.tft.on('riot:progress', (p) => {
    const el = $('#anProgress');
    if (el) el.textContent = p.step === 'ids' ? 'Maç listesi alınıyor…' : `Maçlar indiriliyor: ${p.done}/${p.total}`;
  });
}

async function boot() {
  $('#view').innerHTML = spinner('Set verileri yükleniyor… (ilk açılışta biraz sürebilir)');
  try {
    state.settings = await call('settings:get');
    updateSidebar();
    state.S = await call('static:get');
    $('#setLabel').textContent = `Set ${state.S.setNumber}${state.version ? ` · v${state.version}` : ''}`;
  } catch (e) {
    $('#view').innerHTML = emptyState('Veriler yüklenemedi', e.message, '<button class="btn" id="retryBoot">Tekrar dene</button>');
    $('#retryBoot').addEventListener('click', boot);
    return;
  }
  call('riot:lastAnalysis').then((a) => { state.analysis = a; }).catch(() => {});
  call('engine:status').then((s) => { state.engine = s; renderEngineStatus(); }).catch(() => {});
  state.liveCtx = { S: state.S, getMeta: () => state.meta, compact: false, refocus: null };
  await Live.init();
  Live.on((type) => {
    if (state.view !== 'live') return;
    if (type === 'form') renderLiveFormInto($('#liveForm'), state.liveCtx);
    else if (type === 'busy') $('#liveResult')?.classList.add('busy');
    else if (type === 'result') renderLiveResult();
  });
  show(state.view);
  loadMeta(false);
}

function engineStatusText(e) {
  if (!e) return 'Motor durumu yükleniyor…';
  const parts = [
    e.running ? '🟢 Veri topluyor' : '⚪ Durdu',
    `${(e.matches || 0).toLocaleString('tr-TR')} yüksek elo maçı`,
  ];
  if (e.running && e.players) parts.push(`oyuncu ${Math.min(e.playerIndex + 1, e.players)}/${e.players}`);
  if (e.stats) parts.push(`istatistik: ${e.stats.matches.toLocaleString('tr-TR')} maç (yama ${e.stats.patches.join(', ') || '?'}), ${timeAgo(e.stats.builtAt)}`);
  if (e.error) parts.push(`⚠ ${e.error}`);
  return parts.join(' · ');
}

function renderEngineStatus() {
  for (const id of ['#engineStatus', '#engineLine']) {
    const el = $(id);
    if (el) el.textContent = engineStatusText(state.engine);
  }
}

async function loadMeta(force) {
  state.metaLoading = true;
  if (state.view === 'meta') renderMeta();
  try {
    state.meta = await call('meta:get', { force });
    const failed = state.meta.sources.filter((s) => !s.ok);
    if (failed.length) toast(`Ulaşılamayan kaynaklar: ${failed.map((s) => s.name).join(', ')}`, 'warn', 6000);
  } catch (e) {
    toast(e.message, 'bad', 8000);
  } finally {
    state.metaLoading = false;
    if (state.view === 'meta') renderMeta();
  }
}

function show(view) {
  state.view = view;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  VIEWS[view]();
  $('#view').scrollTop = 0;
}

function updateSidebar() {
  const s = state.settings;
  if (!s) return;
  const g = s.gameState || {};
  const el = $('#gameStatus');
  el.className = `game-status ${g.inGame ? (g.isTft ? 'on' : 'other') : ''}`;
  el.querySelector('span').textContent = g.inGame ? (g.isTft ? 'TFT maçı algılandı' : 'Başka bir oyun modu açık') : 'Oyun bekleniyor';
  $('#hotkeyHint').textContent = `${s.overlayHotkey || '-'}: overlay · ${s.clickThroughHotkey || '-'}: tıklama geçirgenliği`;
  updateOverlayButton(s.overlayVisible);
}

function updateOverlayButton(visible) {
  if (state.settings) state.settings.overlayVisible = visible;
  $('#overlayToggle').textContent = visible ? 'Overlay\'i gizle' : 'Overlay\'i göster';
}

function renderUpdate(u) {
  const box = $('#updateBox');
  if (!box || !u) return;
  if (u.status === 'downloading') {
    box.hidden = false;
    box.innerHTML = `<span>⬇️ Güncelleme indiriliyor${u.version ? ` (v${esc(u.version)})` : ''} %${u.percent || 0}</span>`;
  } else if (u.status === 'ready') {
    box.hidden = false;
    box.innerHTML = `<span>✨ v${esc(u.version)} hazır</span><button class="btn btn-sm btn-gold" data-act="update-install">Yeniden başlat ve güncelle</button>`;
  } else {
    box.hidden = true;
  }
  if (state.S) $('#setLabel').textContent = `Set ${state.S.setNumber}${state.version ? ` · v${state.version}` : ''}`;
}

function askCoach(question) {
  show('coach');
  sendChat(question);
}

/* ───────────── Meta ───────────── */

const stat = (v, l) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`;

function renderMeta() {
  const m = state.meta;
  const f = state.metaFilter;
  const styles = m ? [...new Set(m.comps.map((c) => c.levelling).filter(Boolean))].sort() : [];
  const okSources = m ? m.sources.filter((s) => s.ok).length : 0;
  $('#view').innerHTML = `
    <header class="view-head">
      <div>
        <h1>Meta Comp'lar</h1>
        <p class="muted">${m ? `${okSources} kaynağın birleşimi · ${m.comps.length} comp · güncellendi ${timeAgo(m.fetchedAt)}` : 'Kaynaklardan veri toplanıyor…'}</p>
      </div>
      <div class="toolbar">
        <input id="metaSearch" type="search" placeholder="Şampiyon, trait veya comp ara…" value="${esc(f.q)}">
        <select id="metaStyle"><option value="">Tüm oyun tarzları</option>${styles.map((s) => `<option ${s === f.style ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select id="metaMinSrc">${[1, 2, 3].map((n) => `<option value="${n}" ${n === f.minSources ? 'selected' : ''}>${n === 1 ? 'Tüm comp\'lar' : `En az ${n} kaynak`}</option>`).join('')}</select>
        <button class="btn" id="metaRefresh" ${state.metaLoading ? 'disabled' : ''}>${state.metaLoading ? 'Yükleniyor…' : '↻ Yenile'}</button>
      </div>
    </header>
    ${m ? sourceBar(m.sources) : ''}
    <p class="muted small legend">Tier, kaynakların verdiği tier'ların ortalamasıdır. İstatistik sitelerinde (MetaTFT, tactics.tools) tier, Elmas+ maçlardaki ortalama sıralamaya göre hesaplanır.</p>
    <div id="compList" class="comp-list">${m ? '' : spinner('MetaTFT, tactics.tools, TFT Academy, lolchess, TFT Flow ve BunnyMuffins taranıyor…')}</div>`;
  $('#metaSearch').addEventListener('input', (e) => { f.q = e.target.value; renderCompList(); });
  $('#metaStyle').addEventListener('change', (e) => { f.style = e.target.value; renderCompList(); });
  $('#metaMinSrc').addEventListener('change', (e) => { f.minSources = Number(e.target.value); renderCompList(); });
  $('#metaRefresh').addEventListener('click', () => loadMeta(true));
  $('#compList').addEventListener('click', onCompClick);
  if (m) renderCompList();
}

function sourceBar(sources) {
  return `<div class="source-bar">${sources.map((s) => {
    const cls = s.ok ? (s.stale ? 'stale' : 'ok') : 'fail';
    const title = s.ok ? `${s.count} comp${s.stale ? ` · önbellekten (${s.error})` : ''}` : s.error;
    return `<button class="source ${cls}" data-url="${esc(s.url)}" title="${esc(title)}"><i></i>${esc(s.name)}<small>${s.ok ? s.count : 'hata'}</small></button>`;
  }).join('')}</div>`;
}

function filteredComps() {
  const S = state.S;
  const f = state.metaFilter;
  const words = trLower(f.q.trim()).split(/\s+/).filter(Boolean);
  return state.meta.comps.filter((c) => {
    if (f.style && c.levelling !== f.style) return false;
    if (c.sources.length < f.minSources) return false;
    if (!words.length) return true;
    const hay = trLower([c.name, ...c.altNames, ...c.units.map((u) => {
      const ch = S.champById[u];
      return ch ? `${ch.name} ${ch.traitNames.join(' ')}` : u;
    })].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

function renderCompList() {
  const list = $('#compList');
  if (!list || !state.meta) return;
  const comps = filteredComps();
  list.innerHTML = comps.length ? comps.map(compCard).join('') : emptyState('Sonuç bulunamadı', 'Aramayı veya filtreleri değiştir.');
}

function compCard(c) {
  const S = state.S;
  const pinned = state.settings?.pinnedCompId === c.id;
  const carryItems = Object.fromEntries(c.carries.map((x) => [x.unit, x.items]));
  const traits = c.traits.filter((t) => t.tierIndex > 0 && !t.unique).slice(0, 6);
  const open = state.openDetails.has(c.id);
  const stats = c.avg != null
    ? `<div class="comp-stats">${stat(num(c.avg), 'Ort. sıra')}${stat(pct(c.top4), 'Top 4')}${stat(pct(c.win), '1.lik')}${stat(pct(c.pick, 1), 'Oynanma')}</div>`
    : '';
  const units = c.units.length
    ? `<div class="comp-units">${sortUnits(S, c.units).map((u) => unitIcon(S, u, { items: carryItems[u], star: c.stars.includes(u) ? 3 : 0, carry: !!carryItems[u] })).join('')}</div>`
    : '<p class="muted small">Bu kaynak birim listesi paylaşmıyor; ayrıntılar için kaynak bağlantısına tıkla.</p>';
  return `<article class="comp card" data-id="${esc(c.id)}">
    <div class="comp-top">
      ${tierBadge(c.tier)}
      <div class="comp-title">
        <h3>${esc(c.name)}</h3>
        <div class="comp-sub">
          ${c.levelling ? `<span class="tag">${esc(c.levelling)}</span>` : ''}
          ${c.guide?.difficulty ? `<span class="tag">${esc(DIFFICULTY[c.guide.difficulty] || c.guide.difficulty)}</span>` : ''}
          ${traits.map(traitChip).join('')}
        </div>
        <div class="sources">${sourceChips(c)}</div>
      </div>
      ${stats}
    </div>
    ${units}
    <div class="comp-actions">
      ${c.units.length ? `<button class="btn btn-sm ${pinned ? 'btn-gold' : ''}" data-act="pin">${pinned ? '📌 Overlay\'de' : '📌 Overlay\'e sabitle'}</button>` : ''}
      <button class="btn btn-sm btn-ghost" data-act="detail">${open ? 'Detayı gizle' : 'Detaylar'}</button>
      ${c.teamCode ? '<button class="btn btn-sm btn-ghost" data-act="code">📋 Takım kodu</button>' : ''}
      <button class="btn btn-sm btn-ghost" data-act="ask">🤖 Nasıl oynanır?</button>
    </div>
    ${open ? `<div class="comp-detail">${compDetail(c)}</div>` : ''}
  </article>`;
}

function compDetail(c) {
  const S = state.S;
  const g = c.guide;
  const parts = [];
  if (c.stats.length) {
    parts.push(`<section><h4>İstatistikler</h4>
      <table class="tbl"><thead><tr><th>Kaynak</th><th>Ort. sıra</th><th>Top 4</th><th>1.lik</th><th>Oyun</th></tr></thead>
      <tbody>${c.stats.map((s) => `<tr><td>${esc(s.source)}</td><td>${num(s.avg)}</td><td>${pct(s.top4)}</td><td>${pct(s.win)}</td><td>${(s.count || 0).toLocaleString('tr-TR')}</td></tr>`).join('')}</tbody></table>
      ${c.places ? placementBars(c.places) : ''}</section>`);
  }
  parts.push(`<section><h4>Oyun planı</h4><p>${esc(levellingTip(c.levelling))}</p>
    ${g?.early?.length ? `<div class="label">Erken board</div><div class="unit-row">${g.early.map((u) => unitIcon(S, u, { size: 'sm' })).join('')}</div>` : ''}
    ${g?.tips?.length ? `<ul class="tips">${g.tips.map((t) => `<li><b>${esc(t.stage)}</b> ${esc(t.tip)}</li>`).join('')}</ul><p class="muted small">İpuçları TFT Academy'den alınmıştır (İngilizce). Türkçe açıklama için "Nasıl oynanır?" butonunu kullan.</p>` : ''}
  </section>`);
  if (c.carries.length) {
    parts.push(`<section><h4>Carry eşyaları</h4>${c.carries.map((x) => `<div class="carry-row">${unitIcon(S, x.unit, { size: 'sm', noName: true })}<div><b>${esc(S.champById[x.unit]?.name || x.unit)}</b><div class="item-row">${x.items.map((i) => `<span class="item-chip">${itemIcon(S, i, 'sm')}${esc(itemName(S, i))}</span>`).join('')}</div></div></div>`).join('')}</section>`);
  }
  if (c.augments.length) {
    parts.push(`<section><h4>Önerilen güçlendirmeler</h4><div class="aug-row">${c.augments.map((a) => `<span class="aug">${itemIcon(S, a, 'sm')}${esc(itemName(S, a))}</span>`).join('')}</div>${g?.augmentsTip ? `<p class="muted small">${esc(g.augmentsTip)}</p>` : ''}</section>`);
  }
  if (g?.carousel?.length) {
    parts.push(`<section><h4>Karuselde öncelik</h4><div class="item-row">${g.carousel.map((i) => `<span class="item-chip">${itemIcon(S, i, 'sm')}${esc(itemName(S, i))}</span>`).join('')}</div></section>`);
  }
  if (c.traits.length) parts.push(`<section><h4>Trait'ler</h4><div class="trait-row">${c.traits.map(traitChip).join('')}</div></section>`);
  parts.push(`<section><h4>Kaynaklar</h4><div class="link-row">${c.sources.map((s) => `<button class="link" data-url="${esc(s.url)}">${esc(s.name)}: ${esc(s.title || '')}${s.tier ? ` (${esc(s.tier)})` : ''} ↗</button>`).join('')}</div></section>`);
  return `<div class="detail-grid">${parts.join('')}</div>`;
}

async function onCompClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.comp');
  const comp = state.meta.comps.find((c) => c.id === card.dataset.id);
  if (!comp) return;
  switch (btn.dataset.act) {
    case 'pin': {
      const pinned = state.settings.pinnedCompId === comp.id;
      try {
        await call('overlay:pin', pinned ? null : comp);
        state.settings.pinnedCompId = pinned ? null : comp.id;
        renderCompList();
        toast(pinned ? 'Sabitleme kaldırıldı.' : 'Comp overlay\'e sabitlendi.', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      }
      break;
    }
    case 'detail':
      if (state.openDetails.has(comp.id)) state.openDetails.delete(comp.id);
      else state.openDetails.add(comp.id);
      card.outerHTML = compCard(comp);
      break;
    case 'code':
      copyTeamCode(comp.teamCode);
      break;
    case 'ask':
      askCoach(`"${comp.name}" comp'unu nasıl oynamalıyım? Erken ve orta oyunu, final board'u, eşyaları ve seviye planını anlat.`);
      break;
    default:
  }
}

/* ───────────── Canlı Koç ───────────── */

function renderLive() {
  $('#view').innerHTML = `
    <header class="view-head">
      <div><h1>Canlı Koç</h1>
        <p class="muted">Oyundaki durumunu gir; ekonomi, comp, eşya ve board önerileri anında güncellenir. Overlay'deki Koç sekmesiyle eşzamanlı çalışır.</p>
        <p class="muted small" id="engineLine">${esc(engineStatusText(state.engine))}</p></div>
      <div class="toolbar"><button class="btn" id="liveAsk">🤖 AI koça bu durumu sor</button></div>
    </header>
    <div class="live-layout"><div id="liveForm"></div><div id="liveResult" class="live-result"></div></div>`;
  renderLiveFormInto($('#liveForm'), state.liveCtx);
  bindLiveForm($('#liveForm'), state.liveCtx);
  $('#liveResult').addEventListener('click', (e) => {
    const b = e.target.closest('[data-target-comp]');
    if (b) Live.set({ compId: b.dataset.targetComp }, { render: true });
  });
  $('#liveAsk').addEventListener('click', () => {
    state.includeLive = true;
    askCoach('Şu anki oyun durumuma göre ne yapmalıyım? Ekonomi, comp, eşya ve board kararlarımı gerekçeleriyle değerlendir.');
  });
  renderLiveResult();
  if (!Live.result && !Live.busy) Live.compute();
}

function renderLiveResult() {
  const el = $('#liveResult');
  if (!el) return;
  el.classList.remove('busy');
  el.innerHTML = liveResultHtml(state.S, false);
}

/* ───────────── Planlayıcı ───────────── */

function plannerTraits() {
  return state.S.traits.filter((t) => !t.unique && t.breakpoints.length > 1);
}

function renderPlanner() {
  const S = state.S;
  const traits = plannerTraits();
  if (!state.plannerSel) {
    const def = traits.find((t) => /Blossom/i.test(t.apiName)) || traits[0];
    state.plannerSel = { trait: def.apiName, target: def.breakpoints[def.breakpoints.length - 1] };
  }
  const sel = state.plannerSel;
  const trait = S.traitsById[sel.trait];
  const quick = [...traits].filter((t) => t.breakpoints[t.breakpoints.length - 1] >= 6)
    .sort((a, b) => b.breakpoints[b.breakpoints.length - 1] - a.breakpoints[a.breakpoints.length - 1]);

  $('#view').innerHTML = `
    <header class="view-head"><div>
      <h1>Comp Planlayıcı</h1>
      <p class="muted">Bir trait'i istediğin kademeye (ör. 11 Çiçek) çıkarmak için gereken şampiyonları, amblemleri, seviye planını ve tamamlayıcı birimleri hesaplar.</p>
    </div></header>
    <div class="card planner-form">
      <label>Trait<select id="plTrait">${traits.map((t) => `<option value="${esc(t.apiName)}" ${t.apiName === sel.trait ? 'selected' : ''}>${esc(t.name)} (${t.breakpoints.join('/')})</option>`).join('')}</select></label>
      <label>Hedef<select id="plTarget">${trait.breakpoints.map((b) => `<option ${b === sel.target ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <button class="btn btn-gold" id="plGo">Planla</button>
    </div>
    <div class="quick-row" id="plQuick">${quick.map((t) => `<button class="chip" data-trait="${esc(t.apiName)}" data-target="${t.breakpoints[t.breakpoints.length - 1]}">${t.breakpoints[t.breakpoints.length - 1]} ${esc(t.name)}</button>`).join('')}</div>
    <div id="plResult">${state.plannerResult ? planHtml(state.plannerResult) : ''}</div>`;

  $('#plTrait').addEventListener('change', (e) => {
    const t = S.traitsById[e.target.value];
    state.plannerSel = { trait: t.apiName, target: t.breakpoints[t.breakpoints.length - 1] };
    renderPlanner();
  });
  $('#plTarget').addEventListener('change', (e) => { state.plannerSel.target = Number(e.target.value); });
  $('#plGo').addEventListener('click', runPlan);
  $('#plQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-trait]');
    if (!b) return;
    state.plannerSel = { trait: b.dataset.trait, target: Number(b.dataset.target) };
    renderPlanner();
    runPlan();
  });
  $('#plResult').addEventListener('click', onPlanClick);
}

async function runPlan() {
  const box = $('#plResult');
  box.innerHTML = spinner('Hesaplanıyor…');
  try {
    state.plannerResult = await call('planner:plan', state.plannerSel);
    if ($('#plResult')) $('#plResult').innerHTML = planHtml(state.plannerResult);
  } catch (e) {
    box.innerHTML = emptyState('Plan oluşturulamadı', e.message);
  }
}

function planHtml(p) {
  const S = state.S;
  const carriers = new Set(p.board.emblemCarriers);
  const em = p.emblem;
  const recipe = em
    ? (em.from.length ? em.from.map((i) => `<span class="item-chip">${itemIcon(S, i, 'sm')}${esc(itemName(S, i))}</span>`).join('<span class="plus">+</span>') : '<span class="muted">Eşyayla yapılamaz</span>')
    : '';
  const augs = (list) => `<div class="aug-row">${list.map((a) => `<span class="aug">${itemIcon(S, a, 'sm')}${esc(itemName(S, a))}</span>`).join('')}</div>`;

  return `
  <section class="card plan-hero">
    <div class="plan-title">${p.trait.icon ? `<img src="${esc(p.trait.icon)}" class="trait-icon-lg" alt="">` : ''}
      <div><h2>${p.target} ${esc(p.trait.name)}</h2><p class="muted">${esc(p.trait.summary)}</p></div></div>
    <div class="tiles">
      ${tile(p.available, `${p.trait.name} şampiyonu`)}
      ${tile(p.emblemsNeeded, 'Gereken amblem', p.emblemsNeeded ? 'warn' : 'good')}
      ${tile(p.slotsNeeded, 'Gereken birim alanı')}
      ${tile(p.recommendedLevel, 'Önerilen seviye')}
      ${p.extraSlots ? tile(`+${p.extraSlots}`, 'Ek takım slotu', 'bad') : ''}
    </div>
    ${p.warnings.length ? `<ul class="warnings">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${em && p.emblemsNeeded ? `<div class="emblem-box">${itemIcon(S, em.apiName, 'md')}<div><b>${esc(em.name)}</b><div class="recipe">${recipe}</div></div></div>` : ''}
  </section>

  <div class="plan-grid">
    <section class="card"><h3>${esc(p.trait.name)} şampiyonları</h3><div class="unit-row">${p.traitUnits.map((u) => unitIcon(S, u)).join('')}</div></section>
    <section class="card"><h3>Seviyeye göre alan</h3><table class="tbl"><tbody>${p.levels.map((l) => `<tr><td>Seviye ${l.level}</td><td class="${l.ok ? 'ok' : 'bad'}">${l.ok ? (l.freeSlots ? `${l.freeSlots} boş slot kalır` : 'Tüm alan bu trait için') : `${-l.freeSlots} ek slot gerekir`}</td></tr>`).join('')}</tbody></table></section>
  </div>

  <section class="card"><h3>Adım adım yol</h3><ol class="milestones">${p.milestones.map((m) => `
    <li><div class="ms-head"><b>${m.count} ${esc(p.trait.name)}</b><span class="tag">~Seviye ${m.level}${m.stage ? ` · ${m.stage}` : ''}</span>${m.emblems ? `<span class="tag tag-warn">+${m.emblems} amblem</span>` : ''}</div>
    <div class="unit-row">${m.units.map((u) => unitIcon(S, u, { size: 'sm' })).join('')}</div>
    ${m.tierText ? `<p class="muted small">${esc(m.tierText)}</p>` : ''}</li>`).join('')}</ol></section>

  <section class="card"><h3>Önerilen final board</h3>
    <p class="muted small">"A" işaretli birimler ${esc(p.trait.name)} Amblemi taşır. Tamamlayıcı birimler, meta comp'larda bu trait'le sık oynanan ve ek trait kademesi açan birimlerden seçildi.</p>
    <div class="unit-row">${sortUnits(S, p.board.units).map((u) => unitIcon(S, u, { emblem: carriers.has(u) })).join('')}</div>
    <div class="trait-row">${p.board.traits.filter((t) => t.tierIndex > 0).map(traitChip).join('')}</div>
    <div class="actions-row"><button class="btn btn-sm btn-ghost" data-act="plan-code">📋 Takım kodu</button><button class="btn btn-sm btn-gold" data-act="plan-ai">🤖 AI ile detaylı strateji</button></div>
  </section>

  ${p.relatedComps.length ? `<section class="card"><h3>Bu trait'i kullanan meta comp'lar</h3>${p.relatedComps.map((c) => `
    <div class="mini-comp">${tierBadge(c.tier)}<div class="grow"><b>${esc(c.name)}</b> <small class="muted">${c.traitCount} ${esc(p.trait.name)} · ${esc(c.levelling || '')} · ${esc(c.sources.join(', '))}</small>
    <div class="unit-row tight">${sortUnits(S, c.units).map((u) => unitIcon(S, u, { size: 'xs', noName: true })).join('')}</div></div></div>`).join('')}</section>` : ''}

  ${p.augments.length || (p.extraSlots && p.teamSizeAugments.length) ? `<section class="card"><h3>İlgili güçlendirmeler</h3>
    ${p.augments.length ? augs(p.augments) : ''}
    ${p.extraSlots && p.teamSizeAugments.length ? `<div class="label">Takım slotu artıranlar</div>${augs(p.teamSizeAugments)}` : ''}</section>` : ''}

  <section class="card"><h3>Kademe bonusları</h3><ul class="tier-list">${p.trait.tiers.map((t) => `<li class="${t.minUnits <= p.target ? 'on' : ''}"><b>(${t.minUnits})</b> ${esc(t.text)}</li>`).join('')}</ul></section>`;
}

function onPlanClick(e) {
  const b = e.target.closest('[data-act]');
  const p = state.plannerResult;
  if (!b || !p) return;
  if (b.dataset.act === 'plan-ai') {
    askCoach(`${p.target} ${p.trait.name} yapmanın en iyi yolu ne? Hangi şampiyonlarla başlamalıyım, amblemleri nasıl bulmalıyım, hangi güçlendirmeleri almalıyım ve final board nasıl olmalı?`);
  } else if (b.dataset.act === 'plan-code') {
    copyTeamCode(encodeTeamCode(state.S, p.board.units));
  }
}

/* ───────────── Analiz ───────────── */

const RANKS = {
  IRON: 'Demir', BRONZE: 'Bronz', SILVER: 'Gümüş', GOLD: 'Altın', PLATINUM: 'Platin', EMERALD: 'Zümrüt',
  DIAMOND: 'Elmas', MASTER: 'Ustalık', GRANDMASTER: 'Büyükusta', CHALLENGER: 'Challenger',
};

function detectedText() {
  if (state.detecting) return 'Açık hesap algılanıyor…';
  const d = state.detected;
  if (d) return `Açık hesap: ${esc(d.riotId)}${d.platform ? ` · ${esc(d.platform.toUpperCase())}` : ''}`;
  return 'Açık League/TFT istemcisi bulunamadı. Kayıtlı bir hesap seçebilir ya da istemciyi açıp "Algıla"ya basabilirsin.';
}

function accountOptions() {
  const accs = state.settings.accounts || [];
  const auto = `<option value="">🔍 Otomatik${state.detected ? ` (${esc(state.detected.riotId)})` : ''}</option>`;
  return auto + accs.map((a) => `<option value="${esc(a.riotId)}" ${a.riotId === state.anAccount ? 'selected' : ''}>${esc(a.riotId)} · ${esc(String(a.platform || '').toUpperCase())}</option>`).join('');
}

function renderAnalysis() {
  const s = state.settings;
  const a = state.analysis;
  $('#view').innerHTML = `
    <header class="view-head">
      <div><h1>Oynanış Analizi</h1>
        <p class="muted">${detectedText()}${a ? ` · son analiz: ${esc(a.account.gameName)}#${esc(a.account.tagLine)}, ${timeAgo(a.analyzedAt)}` : ''}</p></div>
      <div class="toolbar">
        <select id="anAccount" title="Analiz edilecek hesap">${accountOptions()}</select>
        <button class="btn btn-ghost" id="anDetect" ${state.detecting ? 'disabled' : ''} title="Açık League/TFT istemcisindeki hesabı algıla">↻ Algıla</button>
        <select id="anCount">${[10, 20, 30, 50].map((n) => `<option value="${n}" ${n === state.anCount ? 'selected' : ''}>Son ${n} maç</option>`).join('')}</select>
        <button class="btn btn-gold" id="anGo" ${!s.hasRiotKey || state.analyzing ? 'disabled' : ''}>${state.analyzing ? 'Analiz ediliyor…' : 'Maçlarımı analiz et'}</button>
      </div>
    </header>
    ${!s.hasRiotKey ? '<div class="callout">Analiz için Ayarlar\'a Riot API anahtarını girmelisin. <button class="btn btn-sm" id="anGoto">Ayarlara git</button></div>' : ''}
    <div id="anProgress" class="muted small"></div>
    <div id="anBody">${a ? analysisHtml(a) : (s.hasRiotKey ? emptyState('Henüz analiz yok', 'Oyun istemcisi açıkken hesabın otomatik algılanır. Son maçlarını analiz etmek için butona bas.') : '')}</div>`;
  $('#anAccount').addEventListener('change', (e) => { state.anAccount = e.target.value; });
  $('#anDetect').addEventListener('click', () => detectAccount(true));
  $('#anCount').addEventListener('change', (e) => { state.anCount = Number(e.target.value); });
  $('#anGo').addEventListener('click', runAnalysis);
  $('#anGoto')?.addEventListener('click', () => show('settings'));
  $('#anBody').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="an-ai"]')) {
      askCoach('Son maçlarımın analizine göre oyun tarzımı değerlendir: güçlü yanlarım neler, en çok neyi yanlış yapıyorum ve sonraki 10 maçta nelere odaklanmalıyım?');
    }
  });
  if (!state.detectTried) {
    state.detectTried = true;
    detectAccount(false);
  }
}

async function detectAccount(notify) {
  state.detecting = true;
  if (state.view === 'analysis') renderAnalysis();
  try {
    const r = await call('account:detect');
    state.detected = r.detected;
    state.settings.accounts = r.accounts || [];
    if (notify) {
      toast(r.detected ? `Algılanan hesap: ${r.detected.riotId}` : 'Açık League/TFT istemcisi bulunamadı.', r.detected ? 'good' : 'warn');
    }
  } catch (e) {
    if (notify) toast(e.message, 'bad');
  } finally {
    state.detecting = false;
    if (state.view === 'analysis') renderAnalysis();
  }
}

async function runAnalysis() {
  const account = (state.settings.accounts || []).find((x) => x.riotId === state.anAccount) || null;
  state.analyzing = true;
  renderAnalysis();
  try {
    state.analysis = await call('riot:analyze', { count: state.anCount, account });
    const fresh = await call('settings:get');
    state.settings.accounts = fresh.accounts || [];
    toast(`Analiz tamamlandı: ${state.analysis.account.gameName}#${state.analysis.account.tagLine}`, 'good');
  } catch (e) {
    toast(e.message, 'bad', 9000);
  } finally {
    state.analyzing = false;
    if (state.view === 'analysis') renderAnalysis();
  }
}

function statTable(rows, isComp) {
  if (!rows.length) return '<p class="muted">Veri yok.</p>';
  return `<table class="tbl"><thead><tr><th>${isComp ? 'Comp' : 'Trait'}</th><th>Maç</th><th>Ort.</th><th>Top 4</th></tr></thead>
    <tbody>${rows.slice(0, 10).map((r) => `<tr><td>${isComp && r.tier ? `${tierBadge(r.tier)} ` : ''}${esc(r.name)}</td><td>${r.games}</td><td class="${r.avg <= 4 ? 'ok' : r.avg > 4.5 ? 'bad' : ''}">${num(r.avg)}</td><td>${pct(r.top4)}</td></tr>`).join('')}</tbody></table>`;
}

function reviewHtml(g) {
  const r = g.review;
  if (!r) return '';
  const parts = [];
  if (r.augments.length) {
    parts.push(`<span class="rv">Güçlendirmeler: ${r.augments.map((a) => `<span class="rv-aug rv-${a.verdict}" title="Yüksek elo ort. sıra ${num(a.avg)} (${a.n} oyun)">${esc(a.name)}</span>`).join(' ')}</span>`);
  }
  if (r.items.length) {
    parts.push(`<span class="rv">Eşya: ${r.items.slice(0, 2).map((x) => `${esc(x.unitName)}'da ${esc(x.itemName)} (ort. ${num(x.itemAvg)}) yerine <b>${esc(x.betterName)}</b> (ort. ${num(x.betterAvg)})`).join('; ')}</span>`);
  }
  if (r.board) parts.push(`<span class="rv">Elenirken board gücün ${r.board.power}; bu turda elenenlerin medyanı ${Math.round(r.board.danger)}</span>`);
  if (r.altComps.length) {
    parts.push(`<span class="rv">${r.playedTop ? '✓ Eşya ve güçlendirmelerine uygun bir comp oynadın' : 'Eşya ve güçlendirmelerine daha uygun olanlar'}: ${r.altComps.map((c) => esc(c.name)).join(', ')}</span>`);
  }
  return parts.length ? `<div class="review">${parts.join('')}</div>` : '';
}

function analysisHtml(a) {
  const S = state.S;
  const s = a.summary;
  const r = a.rank;
  const icon = { good: '✓', warn: '!', bad: '✕' };
  return `
  <section class="card an-head">
    <div><h2>${esc(a.account.gameName)} <span class="muted">#${esc(a.account.tagLine)}</span></h2>
      <p class="muted">${r ? `${esc(RANKS[r.tier] || r.tier)} ${esc(r.rank)} · ${r.leaguePoints} LP · ${r.wins}G / ${r.losses}M` : 'Dereceli bilgisi yok'}${s.excluded ? ` · ${s.excluded} maç (farklı mod veya set) hariç tutuldu` : ''}</p></div>
    <button class="btn btn-gold" data-act="an-ai">🤖 AI koçtan yorum al</button>
  </section>
  <div class="tiles">
    ${tile(num(s.avgPlacement), 'Ort. sıra', s.avgPlacement <= 4 ? 'good' : s.avgPlacement <= 4.5 ? 'warn' : 'bad')}
    ${tile(pct(s.top4), 'Top 4')}${tile(pct(s.win), '1.lik')}${tile(num(s.avgLevel, 1), 'Ort. seviye')}
    ${tile(Math.round(s.avgDamage || 0), 'Ort. oyuncu hasarı')}${tile(s.games, 'Maç')}
  </div>
  <div class="an-grid">
    <section class="card"><h3>Sıra dağılımı</h3>${placementBars(s.dist)}</section>
    <section class="card"><h3>Tespitler ve öneriler</h3><ul class="insights">${a.insights.map((i) => `<li class="ins ins-${i.type}"><i>${icon[i.type]}</i><div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p></div></li>`).join('')}</ul></section>
  </div>
  <div class="an-grid">
    <section class="card"><h3>Comp performansın</h3>${statTable(a.compStats, true)}</section>
    <section class="card"><h3>Ana trait performansın</h3>${statTable(a.traitStats, false)}</section>
  </div>
  ${a.augmentStats.length ? `<section class="card"><h3>Güçlendirmeler (en az 2 maç)</h3><table class="tbl"><thead><tr><th>Güçlendirme</th><th>Maç</th><th>Ort. sıra</th></tr></thead><tbody>${a.augmentStats.map((x) => `<tr><td><span class="aug">${itemIcon(S, x.id, 'sm')}${esc(x.name)}</span></td><td>${x.games}</td><td>${num(x.avg)}</td></tr>`).join('')}</tbody></table></section>` : ''}
  <section class="card"><h3>Maç geçmişi</h3><div class="matches">${a.games.map((g) => `
    <div class="match">${placeBadge(g.placement)}
      <div class="match-info"><b>${esc(g.comp?.name || g.mainTrait?.name || 'Karışık board')}</b>
        <small class="muted">${new Date(g.date).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(g.queueName)} · Seviye ${g.level} · ${g.stage} · ${g.gold} altın kaldı</small>
        <div class="trait-row">${g.traits.filter((t) => !t.unique).slice(0, 5).map(traitChip).join('')}</div>
        ${reviewHtml(g)}</div>
      <div class="unit-row tight">${[...g.units].sort((x, y) => x.cost - y.cost).map((u) => unitIcon(S, u.apiName, { size: 'xs', star: u.star, items: u.items, noName: true })).join('')}</div>
    </div>`).join('')}</div></section>`;
}

/* ───────────── AI Koç ───────────── */

const SUGGESTIONS = [
  '11 Çiçek yapmanın en iyi yolu ne?',
  'Şu an en güçlü 3 comp hangisi ve neden?',
  'Kötü başlangıçta hangi comp\'a geçmeliyim?',
  'Maçlarıma göre en büyük hatam ne?',
];

function renderCoach() {
  const s = state.settings;
  $('#view').innerHTML = `
    <header class="view-head">
      <div><h1>AI Koç</h1><p class="muted">Gemini (${esc(s.geminiModel)}) · güncel set verisi, birleşik meta ve maç analizinle yanıt verir</p></div>
      <div class="toolbar">
        <label class="check"><input type="checkbox" id="chIncl" ${state.includeAnalysis ? 'checked' : ''}> Maç analizimi dahil et</label>
        <label class="check"><input type="checkbox" id="chLive" ${state.includeLive ? 'checked' : ''}> Canlı oyun durumumu dahil et</label>
        <button class="btn btn-ghost" id="chClear">Sohbeti temizle</button>
      </div>
    </header>
    ${!s.hasGeminiKey ? '<div class="callout">AI koç için Gemini API anahtarı gerekiyor (Google AI Studio\'dan alınabilir; Flash-Lite modelleri çok düşük maliyetlidir). <button class="btn btn-sm" id="chGoto">Ayarlara git</button></div>' : ''}
    <div class="chat" id="chat"></div>
    <div class="chips" id="chips">${SUGGESTIONS.map((q) => `<button class="chip">${esc(q)}</button>`).join('')}<button class="chip" data-live="1">Şu anki oyun durumuma göre ne yapmalıyım?</button></div>
    <form class="chat-input" id="chForm">
      <textarea id="chText" rows="2" placeholder="Örn: 11 Çiçek için kaç amblem lazım? (Enter: gönder · Shift+Enter: yeni satır)"></textarea>
      <button class="btn btn-gold" type="submit">Gönder</button>
    </form>`;
  $('#chIncl').addEventListener('change', (e) => { state.includeAnalysis = e.target.checked; });
  $('#chLive').addEventListener('change', (e) => { state.includeLive = e.target.checked; });
  $('#chClear').addEventListener('click', () => { state.chat = []; renderChat(); });
  $('#chGoto')?.addEventListener('click', () => show('settings'));
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.live) {
      state.includeLive = true;
      $('#chLive').checked = true;
    }
    sendChat(b.textContent);
  });
  $('#chForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#chText');
    const q = t.value.trim();
    if (!q) return;
    t.value = '';
    sendChat(q);
  });
  $('#chText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chForm').requestSubmit(); }
  });
  renderChat();
}

function renderChat() {
  const box = $('#chat');
  if (!box) return;
  if (!state.chat.length && !state.chatBusy) {
    box.innerHTML = '<div class="chat-empty">Comp\'lar, trait hedefleri (ör. "11 Çiçek"), eşyalar veya oyun tarzın hakkında soru sor.</div>';
    return;
  }
  box.innerHTML = state.chat.map((m) => {
    const metaLine = m.meta ? [
      m.meta.usedPlan ? `🧩 ${esc(m.meta.usedPlan)} planı kullanıldı` : '',
      m.meta.usedAnalysis ? '📈 maç analizin dahil edildi' : '',
      m.meta.usage?.totalTokenCount ? `${m.meta.usage.totalTokenCount.toLocaleString('tr-TR')} token` : '',
    ].filter(Boolean).join(' · ') : '';
    return `<div class="msg msg-${m.role}${m.error ? ' msg-error' : ''}">${m.role === 'user' || m.error ? `<p>${esc(m.text)}</p>` : md(m.text)}${metaLine ? `<div class="msg-meta">${metaLine}</div>` : ''}</div>`;
  }).join('') + (state.chatBusy ? '<div class="msg msg-model typing"><i></i><i></i><i></i></div>' : '');
  box.scrollTop = box.scrollHeight;
}

async function sendChat(question) {
  if (state.chatBusy) return;
  const history = state.chat.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
  state.chat.push({ role: 'user', text: question });
  state.chatBusy = true;
  renderChat();
  try {
    const r = await call('coach:ask', { question, history, includeAnalysis: state.includeAnalysis, includeLive: state.includeLive });
    state.chat.push({ role: 'model', text: r.text, meta: r });
  } catch (e) {
    state.chat.push({ role: 'model', text: e.message, error: true });
  } finally {
    state.chatBusy = false;
    renderChat();
  }
}

/* ───────────── Eşyalar ───────────── */

function renderItems() {
  const S = state.S;
  const comps = S.components;
  const recipe = (a, b) => S.recipes[[a, b].sort().join('|')];
  const emblems = S.traits.filter((t) => t.emblem).map((t) => t.emblem);
  $('#view').innerHTML = `
    <div id="itemsView">
      <header class="view-head">
        <div><h1>Eşya Rehberi</h1><p class="muted">Bileşen birleşimleri. Ayrıntı için bir eşyaya tıkla.</p></div>
        <div class="toolbar"><input id="itSearch" type="search" placeholder="Eşya ara…"></div>
      </header>
      <div class="items-layout">
        <section class="card"><div class="table-wrap"><table class="recipe-grid">
          <thead><tr><th></th>${comps.map((c) => `<th>${itemIcon(S, c, 'md')}</th>`).join('')}</tr></thead>
          <tbody>${comps.map((a) => `<tr><th>${itemIcon(S, a, 'md')}</th>${comps.map((b) => {
            const id = recipe(a, b);
            return `<td>${id ? `<button class="cell" data-item="${esc(id)}" data-name="${esc(trLower(itemName(S, id)))}">${itemIcon(S, id, 'md')}</button>` : ''}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div></section>
        <section class="card item-detail" id="itDetail"><p class="muted">Ayrıntıları görmek için tablodan bir eşya seç.</p></section>
      </div>
      <section class="card"><h3>Amblemler</h3><div class="emblem-grid">${emblems.map((e) => `
        <button class="emblem-card" data-item="${esc(e.apiName)}">${itemIcon(S, e.apiName, 'md')}<div><b>${esc(e.name)}</b><small class="muted">${e.from.length ? e.from.map((i) => esc(itemName(S, i))).join(' + ') : 'Eşyayla yapılamaz'}</small></div></button>`).join('')}</div></section>
    </div>`;
  $('#itSearch').addEventListener('input', (e) => {
    const q = trLower(e.target.value.trim());
    $$('.recipe-grid .cell').forEach((c) => c.classList.toggle('dim', !!q && !c.dataset.name.includes(q)));
  });
  $('#itemsView').addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]');
    if (b) $('#itDetail').innerHTML = itemDetail(b.dataset.item);
  });
}

function itemDetail(id) {
  const S = state.S;
  const it = S.items[id];
  if (!it) return '<p class="muted">Eşya bulunamadı.</p>';
  return `<div class="item-head">${itemIcon(S, id, 'lg')}<div><h3>${esc(it.name)}</h3>
    ${it.from.length ? `<div class="recipe">${it.from.map((i) => `<span class="item-chip">${itemIcon(S, i, 'sm')}${esc(itemName(S, i))}</span>`).join('<span class="plus">+</span>')}</div>` : ''}</div></div>
    <p class="pre">${esc(it.desc)}</p>`;
}

/* ───────────── Ayarlar ───────────── */

const PLATFORM_OPTIONS = [
  ['tr1', 'Türkiye (TR)'], ['euw1', 'Batı Avrupa (EUW)'], ['eun1', 'Kuzey ve Doğu Avrupa (EUNE)'], ['ru', 'Rusya (RU)'],
  ['me1', 'Orta Doğu (ME)'], ['na1', 'Kuzey Amerika (NA)'], ['br1', 'Brezilya (BR)'], ['la1', 'LAN'], ['la2', 'LAS'],
  ['kr', 'Kore (KR)'], ['jp1', 'Japonya (JP)'], ['oc1', 'Okyanusya (OCE)'], ['sg2', 'Singapur (SG)'], ['tw2', 'Tayvan (TW)'], ['vn2', 'Vietnam (VN)'],
];

function hotkeyFromEvent(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.key)) key = e.key;
  else key = { ' ': 'Space', Home: 'Home', End: 'End', Insert: 'Insert', PageUp: 'PageUp', PageDown: 'PageDown' }[e.key];
  if (!key || (!parts.length && !/^F\d/.test(key))) return null;
  return [...parts, key].join('+');
}

async function renderSettings() {
  if (!state.sourceList) {
    try { state.sourceList = await call('meta:sources'); } catch { state.sourceList = []; }
  }
  const s = state.settings;
  const disabled = new Set(s.disabledSources || []);
  $('#view').innerHTML = `
    <header class="view-head"><div><h1>Ayarlar</h1><p class="muted">API anahtarları bu bilgisayarda Windows şifrelemesiyle saklanır ve yalnızca ilgili servislere gönderilir.</p></div></header>
    <form id="settingsForm" class="settings">
      <section class="card">
        <h3>Riot hesabı (oynanış analizi)</h3>
        <label class="check"><input type="checkbox" id="sAccMode" ${s.accountMode !== 'manual' ? 'checked' : ''}> Açık League/TFT istemcisindeki hesabı otomatik algıla (önerilen)</label>
        <p class="muted small">Açıkken hesap değiştirdiğinde hiçbir şey girmen gerekmez. Algılanan hesaplar aşağıda saklanır; istemci kapalıyken Analiz ekranından seçebilirsin.</p>
        ${(s.accounts || []).length ? `<div class="acc-list">${s.accounts.map((a) => `<div class="acc"><span>${esc(a.riotId)} <small class="muted">${esc(String(a.platform || '').toUpperCase())} · son görülme ${timeAgo(a.lastSeen)}</small></span><button type="button" class="btn btn-sm btn-ghost" data-forget="${esc(a.riotId)}">Unut</button></div>`).join('')}</div>` : ''}
        <div class="form-grid">
          <label>Yedek Riot ID (isteğe bağlı)<input id="sRiotId" placeholder="Oyuncu#TR1" value="${esc(s.riotId)}"></label>
          <label>Varsayılan sunucu<select id="sPlatform">${PLATFORM_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === s.platform ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="span2">Riot API anahtarı
            <input id="sRiotKey" type="password" autocomplete="off" placeholder="${s.hasRiotKey ? 'Kayıtlı ✓ (değiştirmek için yeni anahtarı yapıştır)' : s.riotKeyUnreadable ? '⚠ Kayıtlı anahtar okunamadı, lütfen yeniden gir' : 'RGAPI-…'}"></label>
        </div>
        ${s.hasRiotKey ? '<label class="check"><input type="checkbox" id="sClearRiot"> Kayıtlı Riot anahtarını sil</label>' : ''}
        <p class="muted small">Anahtarı <button type="button" class="link" data-url="https://developer.riotgames.com/">developer.riotgames.com ↗</button> adresinden alabilirsin. Geliştirici anahtarları 24 saatte bir yenilenir; kalıcı kullanım için "Personal API Key" başvurusu yapılabilir.</p>
      </section>

      <section class="card">
        <h3>AI Koç (Gemini)</h3>
        <div class="form-grid">
          <label class="span2">Gemini API anahtarı
            <input id="sGeminiKey" type="password" autocomplete="off" placeholder="${s.hasGeminiKey ? 'Kayıtlı ✓ (değiştirmek için yeni anahtarı yapıştır)' : s.geminiKeyUnreadable ? '⚠ Kayıtlı anahtar okunamadı, lütfen yeniden gir' : 'AIza…'}"></label>
          <label>Model<input id="sModel" list="modelList" value="${esc(s.geminiModel)}"><datalist id="modelList"></datalist></label>
          <label>&nbsp;<button type="button" class="btn" id="sLoadModels">Modelleri getir</button></label>
        </div>
        ${s.hasGeminiKey ? '<label class="check"><input type="checkbox" id="sClearGemini"> Kayıtlı Gemini anahtarını sil</label>' : ''}
        <p class="muted small">Anahtarı <button type="button" class="link" data-url="https://aistudio.google.com/apikey">aistudio.google.com/apikey ↗</button> adresinden alabilirsin. iPhone uygulamanda kullandığın anahtar burada da çalışır. Maliyet açısından "flash-lite" modelleri önerilir.</p>
      </section>

      <section class="card">
        <h3>Oyun içi overlay</h3>
        <div class="form-grid">
          <label>Overlay aç/kapat kısayolu<input id="sHotkey" class="hotkey" readonly value="${esc(s.overlayHotkey)}"></label>
          <label>Tıklama geçirgenliği kısayolu<input id="sCtHotkey" class="hotkey" readonly value="${esc(s.clickThroughHotkey)}"></label>
          <label>Overlay opaklığı <span id="sOpacityVal">${Math.round((s.overlayOpacity || 0.92) * 100)}%</span><input id="sOpacity" type="range" min="0.4" max="1" step="0.02" value="${s.overlayOpacity || 0.92}"></label>
          <label class="check"><input type="checkbox" id="sAuto" ${s.autoOverlay ? 'checked' : ''}> TFT maçı başlayınca overlay'i otomatik aç</label>
        </div>
        <p class="muted small">Kısayol alanına tıklayıp tuş kombinasyonuna bas (ör. Alt+T). Overlay'in oyunun üstünde görünmesi için TFT'yi <b>Kenarlıksız</b> veya <b>Pencereli</b> modda çalıştır. Overlay yalnızca kendi seçtiğin comp ve planları gösterir; rakip bilgisi okumaz (Riot kurallarına uygun).</p>
      </section>

      <section class="card">
        <h3>Kendi istatistik motoru</h3>
        <label class="check"><input type="checkbox" id="sEngine" ${s.engineAutoCollect !== false ? 'checked' : ''}> Yüksek elo maçlarını arka planda topla (önerilen)</label>
        <p class="muted small">Riot API anahtarınla sunucundaki Challenger, Grandmaster ve Master oyuncularının dereceli maçları toplanır. Birim, eşya, güçlendirme ve comp istatistikleri sitelerden bağımsız olarak hesaplanır ve Canlı Koç ile maç analizinde kullanılır. Geliştirici anahtarının limiti nedeniyle saatte birkaç yüz maç birikir; uygulama açık kaldıkça veri artar.</p>
        <p class="small" id="engineStatus">${esc(engineStatusText(state.engine))}</p>
        <div class="actions-row"><button type="button" class="btn btn-sm" id="sEngineRebuild">İstatistikleri şimdi yeniden hesapla</button></div>
      </section>

      <section class="card">
        <h3>Meta kaynakları</h3>
        <div class="source-toggles">${state.sourceList.map((src) => `
          <label class="check"><input type="checkbox" class="src-toggle" value="${esc(src.id)}" ${disabled.has(src.id) ? '' : 'checked'}> ${esc(src.name)} <small class="muted">(${src.kind === 'stats' ? 'istatistik' : 'rehber / tier listesi'})</small></label>`).join('')}</div>
      </section>

      <div class="actions-row"><button class="btn btn-gold" type="submit">Kaydet</button></div>
    </form>`;

  $$('.hotkey').forEach((input) => input.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') { input.value = ''; return; }
    const hk = hotkeyFromEvent(e);
    if (hk) input.value = hk;
  }));
  $('#sOpacity').addEventListener('input', (e) => { $('#sOpacityVal').textContent = `${Math.round(e.target.value * 100)}%`; });
  $('#sLoadModels').addEventListener('click', async () => {
    try {
      const models = await call('gemini:models');
      $('#modelList').innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      toast(`${models.length} model bulundu. Model alanına tıklayıp listeden seçebilirsin.`, 'good');
    } catch (err) {
      toast(err.message, 'bad', 7000);
    }
  });
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#sEngineRebuild').addEventListener('click', async () => {
    try {
      const summary = await call('engine:rebuild');
      state.engine = { ...state.engine, stats: summary };
      renderEngineStatus();
      toast(summary ? `İstatistikler ${summary.matches} maçtan yeniden hesaplandı.` : 'Henüz toplanmış maç yok.', summary ? 'good' : 'warn');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
  $('#settingsForm').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-forget]');
    if (!b) return;
    try {
      state.settings.accounts = await call('account:forget', b.dataset.forget);
      renderSettings();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

async function saveSettings(e) {
  e.preventDefault();
  const payload = {
    riotId: $('#sRiotId').value,
    platform: $('#sPlatform').value,
    accountMode: $('#sAccMode').checked ? 'auto' : 'manual',
    geminiModel: $('#sModel').value.trim() || undefined,
    overlayHotkey: $('#sHotkey').value,
    clickThroughHotkey: $('#sCtHotkey').value,
    autoOverlay: $('#sAuto').checked,
    overlayOpacity: Number($('#sOpacity').value),
    disabledSources: $$('.src-toggle').filter((x) => !x.checked).map((x) => x.value),
    engineAutoCollect: $('#sEngine').checked,
  };
  const riotKey = $('#sRiotKey').value.trim();
  const geminiKey = $('#sGeminiKey').value.trim();
  if (riotKey) payload.riotApiKey = riotKey;
  if (geminiKey) payload.geminiApiKey = geminiKey;
  if ($('#sClearRiot')?.checked) payload.clearRiotKey = true;
  if ($('#sClearGemini')?.checked) payload.clearGeminiKey = true;
  if (payload.riotId && !/^.+#.+$/.test(payload.riotId)) {
    toast('Riot ID "Ad#ETİKET" biçiminde olmalı.', 'warn');
    return;
  }

  const prevDisabled = JSON.stringify([...(state.settings.disabledSources || [])].sort());
  try {
    const r = await call('settings:set', payload);
    state.settings = { ...state.settings, ...r.settings };
    if (r.failedHotkeys.length) toast(`Kısayol kaydedilemedi (başka bir uygulama kullanıyor olabilir): ${r.failedHotkeys.join(', ')}`, 'warn', 7000);
    else toast('Ayarlar kaydedildi.', 'good');
    if (JSON.stringify([...(r.settings.disabledSources || [])].sort()) !== prevDisabled) loadMeta(false);
    updateSidebar();
    renderSettings();
  } catch (err) {
    toast(err.message, 'bad');
  }
}
