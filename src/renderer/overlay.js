'use strict';

const ov = { S: null, meta: null, settings: null, tab: 'coach', pinned: null, traitSel: null, traitPlan: null, liveCtx: null };

document.addEventListener('DOMContentLoaded', init);

function body(html) {
  $('#ovBody').innerHTML = html;
}

async function init() {
  bind();
  body(spinner('Yükleniyor…'));
  try {
    ov.settings = await call('settings:get');
    applySettings();
    ov.S = await call('static:get');
    ov.liveCtx = { S: ov.S, getMeta: () => ov.meta, compact: true, refocus: null };
    await Live.init();
    Live.on((type) => {
      if (ov.tab !== 'coach') return;
      if (type === 'form') renderLiveFormInto($('#ovLiveForm'), ov.liveCtx);
      else if (type === 'busy') $('#ovLiveResult')?.classList.add('busy');
      else if (type === 'result' || type === 'ocr') renderCoachResult();
    });
    ov.pinned = ov.settings.pinnedComp || null;
    render();
    ov.meta = await call('meta:get', {});
    // Kayıtlı comp güncel veride hâlâ varsa en yeni halini kullan.
    if (ov.pinned) ov.pinned = ov.meta.comps.find((c) => c.id === ov.pinned.id) || ov.pinned;
    render();
  } catch (e) {
    body(emptyState('Veri yüklenemedi', e.message));
  }
}

function bind() {
  $('#ovTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    ov.tab = b.dataset.tab;
    syncTabs();
    render();
  });
  $('#ovClose').addEventListener('click', () => call('overlay:hide'));
  $('#ovCt').addEventListener('click', () => {
    call('overlay:clickThrough', true)
      .then(() => toast(`Tıklamalar artık oyuna geçiyor. Kapatmak için ${ov.settings.clickThroughHotkey} kısayolunu kullan.`, 'info', 5000));
  });
  $('#ovBody').addEventListener('click', onBodyClick);

  window.tft.on('comp:pinned', (comp) => {
    ov.pinned = comp;
    ov.tab = 'comp';
    syncTabs();
    render();
  });
  window.tft.on('overlay:clickThrough', (on) => {
    document.body.classList.toggle('click-through', on);
    $('#ctBadge').hidden = !on;
  });
  window.tft.on('game:state', (s) => $('#ovGame').classList.toggle('on', s.inGame && s.isTft));
  window.tft.on('settings:changed', (pub) => {
    ov.settings = { ...ov.settings, ...pub };
    applySettings();
  });
  window.tft.on('meta:updated', async () => {
    ov.meta = await call('meta:get', {}).catch(() => ov.meta);
    if (ov.tab === 'meta') render();
  });
}

function applySettings() {
  const s = ov.settings;
  $('#ovHint').textContent = `${s.overlayHotkey || '-'}: gizle/göster · ${s.clickThroughHotkey || '-'}: tıklama geçirgenliği`;
  $('#ovGame').classList.toggle('on', !!(s.gameState?.inGame && s.gameState?.isTft));
  $('#ctBadge').hidden = !s.clickThrough;
  document.body.classList.toggle('click-through', !!s.clickThrough);
}

function syncTabs() {
  $$('#ovTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ov.tab));
}

function render() {
  if (!ov.S) return;
  ({ coach: renderCoachTab, comp: renderComp, meta: renderMetaTab, trait: renderTraitTab, items: renderItemsTab })[ov.tab]();
}

function renderCoachTab() {
  body('<div id="ovLiveForm"></div><div id="ovLiveResult" class="live-result"></div>');
  renderLiveFormInto($('#ovLiveForm'), ov.liveCtx);
  bindLiveForm($('#ovLiveForm'), ov.liveCtx);
  $('#ovLiveResult').addEventListener('click', (e) => {
    const b = e.target.closest('[data-target-comp]');
    if (b) Live.set({ compId: b.dataset.targetComp });
  });
  renderCoachResult();
  if (!Live.result && !Live.busy) Live.compute();
}

function renderCoachResult() {
  const el = $('#ovLiveResult');
  if (!el) return;
  el.classList.remove('busy');
  el.innerHTML = liveResultHtml(ov.S, true);
}

function renderComp() {
  const S = ov.S;
  const c = ov.pinned;
  if (!c) {
    body(`<div class="ov-empty"><p>Henüz sabitlenmiş comp yok.</p>
      <p class="muted small">Meta sekmesinden bir comp seç ya da ana penceredeki "Overlay'e sabitle" butonunu kullan.</p>
      <button class="btn btn-sm" data-go="meta">Meta listesini aç</button></div>`);
    return;
  }
  const carryItems = Object.fromEntries((c.carries || []).map((x) => [x.unit, x.items]));
  const g = c.guide;
  body(`
    <div class="ov-comp-head">${tierBadge(c.tier)}
      <div class="grow"><b>${esc(c.name)}</b><small class="muted">${esc(c.levelling || '')}${c.avg != null ? ` · ort. ${num(c.avg)} · top 4 ${pct(c.top4)}` : ''}</small></div>
      <button class="icon-btn" data-act="unpin" title="Sabitlemeyi kaldır">✕</button>
    </div>
    <div class="unit-row">${sortUnits(S, c.units).map((u) => unitIcon(S, u, { size: 'sm', items: carryItems[u], star: (c.stars || []).includes(u) ? 3 : 0, carry: !!carryItems[u] })).join('')}</div>
    <div class="ov-section"><h5>Seviye planı</h5><p>${esc(levellingTip(c.levelling))}</p></div>
    ${c.carries?.length ? `<div class="ov-section"><h5>Carry eşyaları</h5>${c.carries.map((x) => `<div class="ov-carry">${unitIcon(S, x.unit, { size: 'xs', noName: true })}<span class="grow">${esc(S.champById[x.unit]?.name || x.unit)}</span>${x.items.map((i) => itemIcon(S, i, 'sm')).join('')}</div>`).join('')}</div>` : ''}
    ${g?.early?.length ? `<div class="ov-section"><h5>Erken board</h5><div class="unit-row tight">${g.early.map((u) => unitIcon(S, u, { size: 'xs' })).join('')}</div></div>` : ''}
    ${g?.tips?.length ? `<div class="ov-section"><h5>İpuçları</h5><ul class="tips">${g.tips.map((t) => `<li><b>${esc(t.stage)}</b> ${esc(t.tip)}</li>`).join('')}</ul></div>` : ''}
    ${c.augments?.length ? `<div class="ov-section"><h5>Güçlendirmeler</h5><div class="aug-row">${c.augments.slice(0, 8).map((a) => itemIcon(S, a, 'sm')).join('')}</div></div>` : ''}
    ${c.stars?.length ? `<div class="ov-section"><h5>3★ hedefleri</h5><div class="unit-row tight">${c.stars.map((u) => unitIcon(S, u, { size: 'xs', star: 3 })).join('')}</div></div>` : ''}
    ${c.traits?.length ? `<div class="ov-section"><h5>Trait'ler</h5><div class="trait-row">${c.traits.filter((t) => t.tierIndex > 0).map(traitChip).join('')}</div></div>` : ''}
    ${c.teamCode ? '<button class="btn btn-sm btn-block" data-act="code">📋 Takım kodunu kopyala</button>' : ''}`);
}

function renderMetaTab() {
  if (!ov.meta) { body(spinner('Meta yükleniyor…')); return; }
  const S = ov.S;
  const comps = ov.meta.comps.filter((c) => c.units.length && ['S', 'A', 'B'].includes(c.tier)).slice(0, 30);
  body(`<input class="ov-search" id="ovSearch" type="search" placeholder="Şampiyon veya trait ara…">
    <div id="ovList">${comps.map((c) => {
      const hay = trLower([c.name, ...c.altNames, ...c.units.map((u) => {
        const ch = S.champById[u];
        return ch ? `${ch.name} ${ch.traitNames.join(' ')}` : '';
      })].join(' '));
      return `<button class="ov-row" data-pin="${esc(c.id)}" data-hay="${esc(hay)}">${tierBadge(c.tier)}
        <div class="grow"><b>${esc(c.name)}</b><small class="muted">${esc(c.levelling || '')} · ${c.sources.length} kaynak${c.avg != null ? ` · ort. ${num(c.avg)}` : ''}</small>
        <div class="unit-row tight">${sortUnits(S, c.units).map((u) => unitIcon(S, u, { size: 'xs', noName: true })).join('')}</div></div></button>`;
    }).join('')}</div>`);
  $('#ovSearch').addEventListener('input', (e) => {
    const q = trLower(e.target.value.trim());
    $$('#ovList .ov-row').forEach((r) => { r.hidden = !!q && !r.dataset.hay.includes(q); });
  });
}

function renderTraitTab() {
  const S = ov.S;
  const traits = S.traits.filter((t) => !t.unique && t.breakpoints.length > 1);
  if (!ov.traitSel) {
    const d = traits.find((t) => /Blossom/i.test(t.apiName)) || traits[0];
    ov.traitSel = { trait: d.apiName, target: d.breakpoints[d.breakpoints.length - 1] };
  }
  const t = S.traitsById[ov.traitSel.trait];
  body(`<div class="ov-form">
      <select id="ovTrait">${traits.map((x) => `<option value="${esc(x.apiName)}" ${x.apiName === t.apiName ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div class="bp-row">${t.breakpoints.map((b) => `<button class="chip ${b === ov.traitSel.target ? 'active' : ''}" data-bp="${b}">${b}</button>`).join('')}</div>
    </div>
    <div id="ovPlan">${ov.traitPlan ? planCompact(ov.traitPlan) : ''}</div>`);
  $('#ovTrait').addEventListener('change', (e) => {
    const nt = S.traitsById[e.target.value];
    ov.traitSel = { trait: nt.apiName, target: nt.breakpoints[nt.breakpoints.length - 1] };
    ov.traitPlan = null;
    renderTraitTab();
  });
  if (!ov.traitPlan) runTraitPlan();
}

async function runTraitPlan() {
  const box = $('#ovPlan');
  if (box) box.innerHTML = spinner('Hesaplanıyor…');
  try {
    ov.traitPlan = await call('planner:plan', ov.traitSel);
    if (ov.tab === 'trait' && $('#ovPlan')) $('#ovPlan').innerHTML = planCompact(ov.traitPlan);
  } catch (e) {
    if ($('#ovPlan')) $('#ovPlan').innerHTML = emptyState('Plan oluşturulamadı', e.message);
  }
}

function planCompact(p) {
  const S = ov.S;
  const carriers = new Set(p.board.emblemCarriers);
  return `<div class="ov-tiles">${tile(p.available, 'şampiyon')}${tile(p.emblemsNeeded, 'amblem', p.emblemsNeeded ? 'warn' : '')}${tile(p.slotsNeeded, 'alan')}${tile(p.recommendedLevel, 'seviye')}</div>
    ${p.warnings.length ? `<ul class="warnings small">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${p.emblem && p.emblemsNeeded ? `<div class="ov-carry">${itemIcon(S, p.emblem.apiName, 'sm')}<span class="grow">${esc(p.emblem.name)}</span>${p.emblem.from.map((i) => itemIcon(S, i, 'sm')).join('<span class="plus">+</span>')}</div>` : ''}
    <div class="ov-section"><h5>Yol</h5>${p.milestones.map((m) => `<div class="ov-ms"><b>${m.count}</b><small class="muted">seviye ${m.level}${m.emblems ? ` · +${m.emblems} amblem` : ''}</small>
      <div class="unit-row tight">${m.units.map((u) => unitIcon(S, u, { size: 'xs', noName: true })).join('')}</div></div>`).join('')}</div>
    <div class="ov-section"><h5>Final board</h5><div class="unit-row tight">${sortUnits(S, p.board.units).map((u) => unitIcon(S, u, { size: 'xs', emblem: carriers.has(u) })).join('')}</div>
      <div class="trait-row">${p.board.traits.filter((t) => t.tierIndex > 0).map(traitChip).join('')}</div></div>`;
}

function renderItemsTab() {
  const S = ov.S;
  const comps = S.components;
  const recipe = (a, b) => S.recipes[[a, b].sort().join('|')];
  body(`<div class="table-wrap"><table class="recipe-grid compact">
      <thead><tr><th></th>${comps.map((c) => `<th>${itemIcon(S, c, 'xs')}</th>`).join('')}</tr></thead>
      <tbody>${comps.map((a) => `<tr><th>${itemIcon(S, a, 'xs')}</th>${comps.map((b) => {
        const id = recipe(a, b);
        return `<td>${id ? `<button class="cell" data-item="${esc(id)}">${itemIcon(S, id, 'sm')}</button>` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div id="ovItem" class="ov-section muted small">Ayrıntı için bir eşyaya tıkla.</div>`);
}

async function onBodyClick(e) {
  const t = e.target.closest('[data-pin],[data-act],[data-go],[data-bp],[data-item]');
  if (!t) return;
  if (t.dataset.pin) {
    const comp = ov.meta?.comps.find((c) => c.id === t.dataset.pin);
    if (comp) await call('overlay:pin', comp);
  } else if (t.dataset.go) {
    ov.tab = t.dataset.go;
    syncTabs();
    render();
  } else if (t.dataset.bp) {
    ov.traitSel.target = Number(t.dataset.bp);
    ov.traitPlan = null;
    renderTraitTab();
  } else if (t.dataset.item) {
    const it = ov.S.items[t.dataset.item];
    if (it) $('#ovItem').innerHTML = `<b>${esc(it.name)}</b><p class="pre">${esc(it.desc)}</p>`;
  } else if (t.dataset.act === 'unpin') {
    await call('overlay:pin', null);
  } else if (t.dataset.act === 'code') {
    copyTeamCode(ov.pinned?.teamCode);
  }
}
