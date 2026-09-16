'use strict';
/* Canlı Koç: oyun durumu girişi ve öneriler (ana pencere ve overlay ortak) */

const LIVE_DEFAULT = {
  stage: '2-1', level: 4, xp: 0, gold: 10, hp: 100, streak: 0,
  components: [], completed: [], augments: [], units: [], traits: [], shop: [], compId: '',
};

const Live = {
  state: { ...LIVE_DEFAULT },
  result: null,
  error: null,
  busy: false,
  timer: null,
  listeners: new Set(),

  async init() {
    window.tft.on('board:status', (s) => {
      this.boardStatus = s;
      this.emit('form');
    });
    try {
      const saved = await call('live:get');
      if (saved && saved.stage) this.state = { ...LIVE_DEFAULT, ...saved };
    } catch { /* varsayılan durumla başla */ }
    // Diğer pencerede (overlay ↔ ana pencere) yapılan değişiklikler
    window.tft.on('live:state', (s) => {
      this.state = { ...LIVE_DEFAULT, ...s };
      this.emit('form');
      this.schedule();
    });
    // Ekrandan okunan değerler yalnızca ana pencerede duruma işlenir (iki kez gönderilmesin diye).
    window.tft.on('ocr:reading', (r) => {
      this.ocr = r;
      if (!r.error && document.body.classList.contains('app')) {
        const patch = {};
        if (r.gold != null && r.gold !== this.state.gold) patch.gold = r.gold;
        if (r.level != null && r.level !== this.state.level) patch.level = r.level;
        if (r.stage && r.stage !== this.state.stage) patch.stage = r.stage;
        if (r.hp != null && r.hp !== this.state.hp) patch.hp = r.hp;
        if (r.traits?.length && JSON.stringify(r.traits) !== JSON.stringify(this.state.traits)) patch.traits = r.traits;
        const shop = (r.shop || []).filter(Boolean);
        if (JSON.stringify(shop) !== JSON.stringify(this.state.shop)) patch.shop = shop;
        if (Object.keys(patch).length) this.set(patch, { render: true });
      }
      this.emit('ocr');
    });
  },

  set(patch, { render = false } = {}) {
    this.state = { ...this.state, ...patch };
    call('live:set', patch).catch(() => {});
    if (render) this.emit('form');
    this.schedule();
  },

  reset() {
    this.state = { ...LIVE_DEFAULT };
    call('live:set', this.state).catch(() => {});
    this.emit('form');
    this.schedule();
  },

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.compute(), 300);
  },

  async compute() {
    this.busy = true;
    this.emit('busy');
    try {
      this.result = await call('coach:now', this.state);
      this.error = null;
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false;
      this.emit('result');
    }
  },

  on(fn) { this.listeners.add(fn); },
  emit(type) { for (const fn of this.listeners) fn(type); },
};

function stepStage(text, delta) {
  const m = String(text).match(/^(\d+)-(\d)$/);
  let s = m ? Number(m[1]) : 2;
  let r = (m ? Number(m[2]) : 1) + delta;
  const maxRound = (x) => (x === 1 ? 4 : 7);
  if (r > maxRound(s)) { s += 1; r = 1; }
  if (r < 1) { s = Math.max(1, s - 1); r = maxRound(s); }
  return `${s}-${r}`;
}

const pickerCache = new Map();

function pickerOptions(S, kind) {
  if (pickerCache.has(kind)) return pickerCache.get(kind);
  let opts;
  if (kind === 'units') {
    opts = S.champions.map((c) => ({ id: c.apiName, name: c.name, icon: c.icon, sub: `${c.cost} altın · ${c.traitNames.join(', ')}` }));
  } else if (kind === 'augments') {
    opts = S.augments.map((id) => S.items[id]).filter(Boolean).map((a) => ({ id: a.apiName, name: a.name, icon: a.icon, sub: '' }));
  } else {
    opts = [...new Set(Object.values(S.recipes))].map((id) => S.items[id]).filter(Boolean)
      .map((i) => ({ id: i.apiName, name: i.name, icon: i.icon, sub: i.from.map((f) => itemName(S, f)).join(' + ') }));
  }
  opts.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  pickerCache.set(kind, opts);
  return opts;
}

function pickerBlock(kind, title, chips) {
  return `<div class="live-block"><div class="label">${title}</div>
    <div class="chip-list">${chips.join('')}
      <div class="picker"><input class="picker-input" data-picker="${kind}" placeholder="+ ara ve ekle…" autocomplete="off"><div class="picker-list" hidden></div></div>
    </div></div>`;
}

function liveFormHtml(S, st, metaComps, compact) {
  const count = (id) => st.components.filter((c) => c === id).length;
  const itemChip = (kind) => (id, i) => `<span class="pick-chip">${itemIcon(S, id, 'xs')}${esc(itemName(S, id))}<button type="button" data-remove="${kind}" data-index="${i}" title="Kaldır">×</button></span>`;
  const unitChip = (u, i) => {
    const c = S.champById[u.id];
    return `<span class="pick-chip cost-${c?.cost || 0}">${c?.icon ? `<img class="chip-portrait" src="${esc(c.icon)}" alt="">` : ''}<button type="button" class="star-btn" data-star-index="${i}" title="Yıldızı değiştir">${'★'.repeat(u.star || 1)}</button>${esc(c?.name || u.id)}<button type="button" data-remove="units" data-index="${i}" title="Kaldır">×</button></span>`;
  };
  return `<div class="live-form ${compact ? 'compact' : 'card'}">
    <div class="live-row">
      <label>Stage<span class="stepper"><button type="button" data-stage="-1">‹</button><input data-field="stage" value="${esc(st.stage)}" maxlength="4"><button type="button" data-stage="1">›</button></span></label>
      <label>Seviye<input type="number" min="1" max="10" data-field="level" value="${st.level}"></label>
      ${compact ? '' : `<label>XP<input type="number" min="0" max="64" data-field="xp" value="${st.xp}"></label>`}
      <label>Altın<input type="number" min="0" max="999" data-field="gold" value="${st.gold}"></label>
      <label>Can<input type="number" min="0" max="100" data-field="hp" value="${st.hp}"></label>
      <label title="Galibiyet serisi için artı, mağlubiyet serisi için eksi sayı">Seri<input type="number" min="-15" max="15" data-field="streak" value="${st.streak}"></label>
    </div>
    <div class="live-block"><div class="label">Bileşenler <small class="muted">(tık: ekle · sağ tık: çıkar)</small></div>
      <div class="comp-picks">${S.components.map((id) => `<button type="button" class="comp-pick ${count(id) ? 'on' : ''}" data-component="${esc(id)}" title="${esc(itemName(S, id))}">${itemIcon(S, id, compact ? 'sm' : 'md')}${count(id) ? `<b>${count(id)}</b>` : ''}</button>`).join('')}</div>
    </div>
    ${pickerBlock('completed', 'Tamamlanmış eşyalar', st.completed.map(itemChip('completed')))}
    ${pickerBlock('augments', 'Güçlendirmeler', st.augments.map(itemChip('augments')))}
    <div class="live-block">
      <div class="label">Tahtamı algıla · deneysel</div>
      <p class="muted small">Kendi tahtanı hazırlık aşamasında aç. Bu düğmeler TFT pencere görüntüsünü Gemini’ye gönderir; API kullanım ücreti oluşabilir. Okunan birimleri aşağıdan kontrol edip düzelt.</p>
      <div class="actions-row"><button type="button" class="btn btn-sm" data-act="board-read">Tahtamı oku ve öner</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="board-auto">${Live.boardStatus?.automatic ? 'Otomatik okumayı durdur' : '30 sn otomatik okumayı başlat'}</button></div>
      <p class="small" role="status">${esc(Live.boardStatus?.error || Live.boardStatus?.message || 'Tahta henüz okunmadı.')}</p>
      ${st.boardReadAt ? `<p class="muted small">Son başarılı okuma: ${esc(new Date(st.boardReadAt).toLocaleTimeString('tr-TR'))}. Liste bu görüntüye aittir.</p>` : ''}
    </div>
    ${pickerBlock('units', 'Sahadaki birimlerin (yedekleri ekleme) <small class="muted">· yıldıza tıkla</small>', st.units.map(unitChip))}
    <label class="live-target">Hedef comp<select data-field="compId"><option value="">Otomatik (tahtama göre)</option>${metaComps.filter((c) => c.units.length).map((c) => `<option value="${esc(c.id)}" ${c.id === st.compId ? 'selected' : ''}>[${esc(c.tier)}] ${esc(c.name)}</option>`).join('')}</select></label>
    ${st.traits?.length ? `<div class="live-block"><div class="label">Ekrandan okunan trait'lerin</div><div class="trait-row">${st.traits.map((t) => `<span class="trait trait-low"><b>${t.count}</b>${esc(t.name)}</span>`).join('')}</div></div>` : ''}
    <div class="actions-row">
      <button type="button" class="btn btn-sm" data-act="live-read" title="Oyun penceresini şimdi oku (algılama beklemeden)">📷 Şimdi oku</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="live-next" title="Stage'i bir tur ilerletir ve beklenen geliri altına ekler">Sonraki tur ›</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="live-reset">Sıfırla</button>
    </div>
  </div>`;
}

function renderLiveFormInto(el, ctx) {
  if (!el) return;
  el.innerHTML = liveFormHtml(ctx.S, Live.state, ctx.getMeta()?.comps || [], ctx.compact);
  if (ctx.refocus) {
    el.querySelector(`[data-picker="${ctx.refocus}"]`)?.focus();
    ctx.refocus = null;
  }
}

function bindLiveForm(root, ctx) {
  const { S } = ctx;
  const numFields = { level: [1, 10], xp: [0, 64], gold: [0, 999], hp: [0, 100], streak: [-15, 15] };

  const hidePicker = (input) => {
    const list = input?.nextElementSibling;
    if (list) list.hidden = true;
  };
  const showPicker = (input) => {
    const kind = input.dataset.picker;
    const list = input.nextElementSibling;
    const q = trLower(input.value.trim());
    if (!q) { list.hidden = true; return; }
    const opts = pickerOptions(S, kind).filter((o) => trLower(o.name).includes(q)).slice(0, 8);
    list.innerHTML = opts.length
      ? opts.map((o) => `<button type="button" data-pick-id="${esc(o.id)}" data-kind="${kind}">${o.icon ? `<img src="${esc(o.icon)}" alt="">` : ''}<span>${esc(o.name)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('')
      : '<div class="muted small picker-empty">Sonuç yok</div>';
    list.hidden = false;
  };

  root.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (f === 'stage') {
      const v = e.target.value.trim();
      if (/^\d{1,2}-\d$/.test(v)) Live.set({ stage: v });
    } else if (numFields[f]) {
      const [lo, hi] = numFields[f];
      const n = Number(e.target.value);
      if (e.target.value !== '' && Number.isFinite(n)) Live.set({ [f]: Math.min(hi, Math.max(lo, Math.round(n))) });
    } else if (e.target.dataset.picker) {
      showPicker(e.target);
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.dataset.field === 'compId') Live.set({ compId: e.target.value });
  });

  root.addEventListener('keydown', (e) => {
    if (!e.target.dataset.picker) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.nextElementSibling.querySelector('[data-pick-id]')?.click();
    } else if (e.key === 'Escape') {
      hidePicker(e.target);
    }
  });

  root.addEventListener('focusout', (e) => {
    if (e.target.dataset.picker) setTimeout(() => hidePicker(e.target), 150);
  });

  root.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-component]');
    if (!b) return;
    e.preventDefault();
    const list = [...Live.state.components];
    const i = list.indexOf(b.dataset.component);
    if (i >= 0) {
      list.splice(i, 1);
      Live.set({ components: list }, { render: true });
    }
  });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-stage],[data-component],[data-remove],[data-star-index],[data-pick-id],[data-act]');
    if (!t) return;
    const st = Live.state;
    if (t.dataset.stage) {
      Live.set({ stage: stepStage(st.stage, Number(t.dataset.stage)) }, { render: true });
    } else if (t.dataset.component) {
      Live.set({ components: [...st.components, t.dataset.component] }, { render: true });
    } else if (t.dataset.remove) {
      const list = [...st[t.dataset.remove]];
      list.splice(Number(t.dataset.index), 1);
      Live.set({ [t.dataset.remove]: list }, { render: true });
    } else if (t.dataset.starIndex !== undefined) {
      const idx = Number(t.dataset.starIndex);
      Live.set({ units: st.units.map((u, i) => (i === idx ? { ...u, star: (u.star || 1) >= 3 ? 1 : (u.star || 1) + 1 } : u)) }, { render: true });
    } else if (t.dataset.pickId) {
      const { kind, pickId: id } = t.dataset;
      ctx.refocus = kind;
      if (kind === 'units') Live.set({ units: [...st.units, { id, star: 1 }] }, { render: true });
      else if (kind === 'augments') {
        if (!st.augments.includes(id) && st.augments.length < 4) Live.set({ augments: [...st.augments, id] }, { render: true });
      } else Live.set({ [kind]: [...st[kind], id] }, { render: true });
    } else if (t.dataset.act === 'board-read' || t.dataset.act === 'board-auto') {
      t.disabled = true;
      const automatic = t.dataset.act === 'board-auto';
      call(automatic ? 'board:auto' : 'board:read', automatic ? { enabled: !Live.boardStatus?.automatic } : undefined)
        .catch(err => { Live.boardStatus = { ...Live.boardStatus, error: err.message }; Live.emit('form'); })
        .finally(() => { t.disabled = false; });
    } else if (t.dataset.act === 'live-next') {
      const income = Live.result?.econ?.facts?.income || 0;
      Live.set({ stage: stepStage(st.stage, 1), gold: st.gold + income }, { render: true });
    } else if (t.dataset.act === 'live-reset') {
      Live.reset();
    } else if (t.dataset.act === 'live-read') {
      t.disabled = true;
      call('ocr:now')
        .then((r) => toast(r ? 'Ekran okundu.' : 'Oyun penceresi bulunamadı.', r ? 'good' : 'warn'))
        .catch((err) => toast(err.message, 'bad', 7000))
        .finally(() => { t.disabled = false; });
    }
  });
}

const ACTION_ICON = { level: '⬆️', rolldown: '🎲', slowroll: '🔁', save: '🏦', spend: '💸' };

function partBar(label, value) {
  return `<span class="part" title="${esc(label)}: ${value}/100"><small>${esc(label)}</small><i><b style="width:${value}%"></b></i></span>`;
}

function oddsTable(odds) {
  const row = (level, arr) => `<tr><td>Seviye ${level}</td>${arr.map((p) => `<td>${p ? `%${Math.round(p * 100)}` : '–'}</td>`).join('')}</tr>`;
  return `<table class="tbl odds"><thead><tr><th>Dükkan olasılığı</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr></thead>
    <tbody>${row(odds.level, odds.current)}${odds.next ? row(odds.level + 1, odds.next) : ''}</tbody></table>`;
}

function liveResultHtml(S, compact) {
  const r = Live.result;
  if (Live.error) return emptyState('Öneri hesaplanamadı', Live.error);
  if (!r) return spinner('Öneriler hesaplanıyor…');
  const e = r.econ;
  const detected = r.detectedComp;
  const boardComp = `<section class="${compact ? 'ov-section' : 'card'} live-card"><h3>Oynadığın comp</h3>${detected
    ? `<b>${esc(detected.name)}</b><p>${detected.shared.length} ortak birimle en yakın eşleşme; kesin sınıflandırma değildir.</p><p>Eksik birimler: ${esc(detected.missing.map(id => S.champById[id]?.name || id).join(', ') || 'Yok')}</p>${Live.state.compId ? '<p>Elle seçtiğin hedef comp önerilerde öncelikli.</p>' : '<p>Eşya ve seviye önerileri bu comp’a göre hesaplandı.</p>'}`
    : '<p>Tahtana yeterince yakın comp bulunamadı. Birimlerini oku veya listeyi düzelt.</p>'}</section>`;
  const fact = (label, value) => `<span class="fact"><small>${esc(label)}</small><b>${esc(value)}</b></span>`;

  const roundTips = r.round?.length ? `<section class="${compact ? 'ov-section' : 'card'} live-card round-tips">
    <h3>⚡ Bu turda</h3>
    <ul class="reasons">${r.round.map((t) => `<li class="tip-${esc(t.type)}">${esc(t.text)}</li>`).join('')}</ul>
  </section>` : '';

  const econ = `<section class="${compact ? 'ov-section' : 'card'} live-card">
    <h3>💰 Ekonomi ve seviye</h3>
    <div class="primary-advice act-${esc(e.primary.action)}"><b>${ACTION_ICON[e.primary.action] || ''} ${esc(e.primary.title)}</b><p>${esc(e.primary.detail)}</p></div>
    ${e.alternatives.length ? `<div class="label">Diğer seçenekler</div><ul class="alt-list">${e.alternatives.map((a) => `<li><b>${ACTION_ICON[a.action] || ''} ${esc(a.title)}</b>${compact ? '' : ` <span class="muted">— ${esc(a.detail)}</span>`}</li>`).join('')}</ul>` : ''}
    <div class="facts">${fact('Faiz', e.facts.interest)}${fact('Sonraki gelir', `+${e.facts.income}`)}${e.facts.level < 10 ? fact(`Sv ${e.facts.level + 1} için`, `${e.facts.goldToLevel} altın`) : ''}${fact('Plan', `${e.plan.name} · hedef sv ${e.facts.targetLevel}`)}</div>
    ${compact ? '' : oddsTable(e.odds)}
  </section>`;

  const recs = r.comps.top.slice(0, compact ? 3 : 5);
  const comps = `<section class="${compact ? 'ov-section' : 'card'} live-card">
    <h3>🧩 Sana en uygun comp'lar <small class="muted">(${r.comps.phase === 'early' ? 'erken' : r.comps.phase === 'mid' ? 'orta' : 'geç'} oyun ağırlıkları)</small></h3>
    ${recs.map((c, i) => `<div class="rec ${r.chosenCompId === c.id ? 'chosen' : ''}">
      <div class="rec-head">${tierBadge(c.tier)}<b class="grow">${i + 1}. ${esc(c.name)}</b><span class="score" title="Uygunluk puanı">${c.score}</span></div>
      <div class="parts">${partBar('Güç', c.parts.strength)}${partBar('Eşya', c.parts.items)}${partBar('Güçl.', c.parts.augments)}${partBar('Birim', c.parts.units)}</div>
      ${c.reasons.length ? `<ul class="reasons">${c.reasons.slice(0, compact ? 2 : 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${c.warnings.map((w) => `<p class="warn-text small">⚠ ${esc(w)}</p>`).join('')}
      <div class="unit-row tight">${sortUnits(S, c.units).map((u) => unitIcon(S, u, { size: 'xs', noName: true, carry: c.carries.some((x) => x.unit === u) })).join('')}</div>
      ${r.chosenCompId === c.id ? '<small class="muted">🎯 Eşya ve board önerileri bu comp\'a göre</small>' : `<button type="button" class="btn btn-sm btn-ghost" data-target-comp="${esc(c.id)}">🎯 Bu comp'a göre öner</button>`}
    </div>`).join('')}
  </section>`;

  const it = r.items;
  const craftRow = (c) => `<div class="craft">${itemIcon(S, c.from[0], 'sm')}<span class="plus">+</span>${itemIcon(S, c.from[1], 'sm')}<span class="arrow">→</span>${itemIcon(S, c.item, 'sm')}<div class="grow"><b>${esc(itemName(S, c.item))}</b>${c.holder ? ` <span class="muted">→ ${esc(S.champById[c.holder]?.name || c.holder)}</span>` : ''}${!compact && c.detail ? `<small class="muted block">${esc(c.detail)}</small>` : ''}</div></div>`;
  const items = (it.crafts.length || it.assignments.length || it.hold.length || it.missing.length) ? `<section class="${compact ? 'ov-section' : 'card'} live-card">
    <h3>⚔️ Eşya kararları</h3>
    ${it.crafts.length ? `<div class="label">Şimdi yap</div>${it.crafts.map(craftRow).join('')}` : ''}
    ${it.hold.length ? `<div class="label">Beklet</div><div class="item-row">${it.hold.map((i) => itemIcon(S, i, 'sm')).join('')}</div>` : ''}
    ${it.assignments.length ? `<div class="label">Tamamlanmış eşyaların</div>${it.assignments.map((a) => `<div class="craft">${itemIcon(S, a.item, 'sm')}<div class="grow"><b>${esc(itemName(S, a.item))}</b> <span class="muted">→ ${a.holder ? esc(S.champById[a.holder]?.name || a.holder) : 'uygun taşıyıcı yok'}</span></div></div>`).join('')}` : ''}
    ${it.missing.length && !compact ? `<div class="label">Carry'ler için hedef eşyalar</div><div class="item-row">${it.missing.map((m) => `<span class="item-chip" title="${esc(m.from.map((f) => itemName(S, f)).join(' + '))}">${itemIcon(S, m.item, 'sm')}${esc(itemName(S, m.item))} <small class="muted">${esc(S.champById[m.unit]?.name || '')}</small></span>`).join('')}</div>` : ''}
  </section>` : '';

  const b = r.board;
  const board = b ? `<section class="${compact ? 'ov-section' : 'card'} live-card">
    <h3>🛡️ Board kontrolü <span class="verdict v-${b.verdict}">${{ weak: 'Zayıf', ok: 'Yeterli', strong: 'Güçlü' }[b.verdict]}</span></h3>
    <p>${esc(b.text)}</p>
    ${b.tips.length ? `<ul class="reasons">${b.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${b.dangerSource === 'fallback' ? '<p class="muted small">Eşik tahmini; motor verisi biriktikçe gerçek yüksek elo değerleri kullanılır.</p>' : ''}
  </section>` : '';

  const ocr = Live.ocr;
  const chosen = r.comps.top.find((c) => c.id === r.chosenCompId);
  let shop = '';
  if (ocr?.error) {
    shop = `<p class="warn-text small">📷 Ekran okuma: ${esc(ocr.error)}</p>`;
  } else if (ocr?.shop?.length) {
    shop = `<section class="${compact ? 'ov-section' : 'card'} live-card">
      <h3>🛒 Dükkanın <small class="muted">(ekrandan · ${Math.max(0, Math.round((Date.now() - ocr.at) / 1000))} sn önce)</small></h3>
      <div class="unit-row">${ocr.shop.map((id) => (id
        ? `<div class="shop-slot ${chosen?.units.includes(id) ? 'fit' : ''}">${unitIcon(S, id, { size: 'sm' })}</div>`
        : '<div class="shop-slot empty">?</div>')).join('')}</div>
      ${chosen ? `<p class="muted small">Altın çerçeveli birimler hedef comp'unda (${esc(chosen.name)}).</p>` : ''}
    </section>`;
  }

  const note = `<p class="muted small engine-note">${r.usesEngineStats ? `📊 Öneriler ${r.engineMatches.toLocaleString('tr-TR')} yüksek elo maçından hesaplanan istatistikleri kullanıyor.` : '📊 Kendi istatistik motorunda henüz yeterli veri yok; öneriler şimdilik site istatistiklerine dayanıyor.'}</p>`;

  return compact
    ? boardComp + roundTips + econ + shop + items + comps + board + note
    : `<div class="live-results">${boardComp}${roundTips}${econ}${shop}${items}${comps}${board}</div>${note}`;
}
