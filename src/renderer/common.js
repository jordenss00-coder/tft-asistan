'use strict';
/* Ana pencere ve overlay'in ortak yardımcıları */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function call(channel, payload) {
  const r = await window.tft.invoke(channel, payload);
  if (!r || !r.ok) throw new Error(r?.error || 'Bilinmeyen hata');
  return r.data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const trLower = (s) => String(s || '').toLocaleLowerCase('tr');
const pct = (v, d = 0) => (v == null ? '–' : `%${(v * 100).toFixed(d).replace('.', ',')}`);
const num = (v, d = 2) => (v == null ? '–' : Number(v).toFixed(d).replace('.', ','));
const prettyId = (id) => String(id || '').replace(/^(TFT\d*|DA)_(\d+_)?/i, '').replace(/(Item|Augment|Component)_/g, '').replace(/_/g, ' ').trim();
const DIFFICULTY = { EASY: 'Kolay', MEDIUM: 'Orta', HARD: 'Zor', CONDITIONAL: 'Koşullu' };

function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} sa önce` : `${Math.round(h / 24)} gün önce`;
}

const DEFAULT_LEVELLING = "Standart: 2-1'de 4, 2-5'te 5, 3-2'de 6, 4-1'de 7, 4-2'de 8. seviye.";
const LEVELLING_TIPS = [
  [/fast\s*9/i, "Stage 4'te seviye 8'e çık ve ekonomini koru; 5-1/5-2'de 9'a çıkıp 4-5 maliyetleri ara."],
  [/fast\s*8|4-cost/i, "3-2'de 6, 4-1'de 7, 4-2'de 8. seviyeye çık ve seviye 8'de roll yaparak 4 maliyetleri bul."],
  [/lose\s*streak/i, "Stage 2-3'te bilinçli kaybedip altın biriktir; 3-5 veya 4-1'de büyük roll yap."],
  [/3.?cost|3 maliyet|lvl\s*7/i, "Seviye 7'de (3-5/4-1) 50 altının üstünü roll yap; 3 maliyetleri 3★ hedefle."],
  [/2.?cost|2 maliyet|lvl\s*6/i, "3-1/3-2'de seviye 6'da 50 altının üstünü roll yap; 2 maliyetleri 3★ hedefle."],
  [/1.?cost|1 maliyet|½|lvl\s*5|reroll/i, "Stage 2-3'te seviye 4-5'te 50 altının üstünü roll yap; 1 maliyetleri 3★ hedefle."],
];

function levellingTip(levelling) {
  if (!levelling) return DEFAULT_LEVELLING;
  const hit = LEVELLING_TIPS.find(([re]) => re.test(levelling));
  return hit ? hit[1] : DEFAULT_LEVELLING;
}

const itemName = (S, id) => S.items[id]?.name || prettyId(id);

function itemIcon(S, id, size = 'sm') {
  const it = S.items[id];
  const title = it ? `${it.name}${it.desc ? `\n\n${it.desc}` : ''}` : prettyId(id);
  return it?.icon
    ? `<img class="item i-${size}" src="${esc(it.icon)}" alt="${esc(it.name)}" title="${esc(title)}" loading="lazy">`
    : `<span class="item i-${size} item-fallback" title="${esc(title)}">${esc(prettyId(id).slice(0, 2))}</span>`;
}

function unitIcon(S, id, o = {}) {
  const c = S.champById[id];
  const name = c?.name || prettyId(id);
  const title = [name, c ? `${c.cost} altın` : '', c?.traitNames.join(', ')].filter(Boolean).join(' · ');
  const stars = o.star >= 2 ? `<span class="stars s${o.star}">${'★'.repeat(o.star)}</span>` : '';
  const items = o.items?.length ? `<span class="unit-items">${o.items.map((i) => itemIcon(S, i, 'xs')).join('')}</span>` : '';
  return `<div class="unit u-${o.size || 'md'} cost-${c?.cost || 0}${o.carry ? ' is-carry' : ''}" title="${esc(title)}">
    <div class="portrait">${c?.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy">` : `<span class="fallback">${esc(name.slice(0, 2))}</span>`}${stars}${o.emblem ? '<span class="emblem-dot" title="Amblem taşıyıcı">A</span>' : ''}</div>
    ${items}${o.noName ? '' : `<span class="unit-name">${esc(name)}</span>`}
  </div>`;
}

function traitChip(t) {
  const cls = t.unique ? 'unique' : t.tierIndex >= t.maxTier ? 'max' : t.tierIndex >= 2 ? 'high' : t.tierIndex >= 1 ? 'low' : 'off';
  return `<span class="trait trait-${cls}" title="${esc(t.name)}: ${t.count}${t.next ? ` (sonraki kademe: ${t.next})` : ''}">${t.icon ? `<img src="${esc(t.icon)}" alt="">` : ''}<b>${t.count}</b>${esc(t.name)}</span>`;
}

function tierBadge(tier) {
  const t = String(tier || '?');
  return `<span class="tier tier-${esc(t.replace('+', 'p').replace('?', 'x'))}">${esc(t)}</span>`;
}

const placeBadge = (p) => `<span class="place place-${p}">${p}</span>`;

function placementBars(places) {
  const total = places.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...places, 1);
  return `<div class="pbars">${places.map((n, i) => `<div class="pbar" title="${i + 1}. sıra: ${n} (${pct(n / total, 1)})"><div class="pbar-track"><i class="p${i + 1}" style="height:${Math.round((n / max) * 100)}%"></i></div><small>${i + 1}</small></div>`).join('')}</div>`;
}

function sourceChips(comp) {
  return comp.sources.map((s) => `<button class="src src-${esc(s.kind)}" data-url="${esc(s.url)}" title="${esc(`${s.name}: ${s.title || ''}`)}">${esc(s.name)}${s.tier ? ` <b>${esc(s.tier)}</b>` : ''}${s.tag ? ` <em>${esc(s.tag)}</em>` : ''}</button>`).join('');
}

function sortUnits(S, units) {
  return [...units].sort((a, b) => (S.champById[a]?.cost || 0) - (S.champById[b]?.cost || 0));
}

function encodeTeamCode(S, units) {
  const codes = units.map((u) => S.teamPlannerCodes?.[u]).filter(Boolean).slice(0, 10);
  if (!codes.length) return null;
  return `02${codes.map((c) => c.toString(16).padStart(3, '0')).join('').padEnd(30, '0')}TFTSet${S.setNumber}`;
}

function copyTeamCode(code) {
  if (!code) return;
  call('clipboard:write', code)
    .then(() => toast('Takım kodu kopyalandı. Oyundaki Takım Planlayıcı\'da içe aktararak kullanabilirsin.', 'good', 5000))
    .catch((e) => toast(e.message, 'bad'));
}

function md(src) {
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '';
  let list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of esc(src).split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      close();
      if ((m = line.match(/^#{1,6}\s+(.*)/))) html += `<h4>${inline(m[1])}</h4>`;
      else if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
  }
  close();
  return html;
}

function toast(msg, type = 'info', ms = 4000) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const spinner = (text) => `<div class="loading"><i class="spin"></i><span>${esc(text || 'Yükleniyor…')}</span></div>`;
const emptyState = (title, text = '', action = '') => `<div class="empty"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
const tile = (v, label, cls = '') => `<div class="tile ${cls}"><b>${esc(v)}</b><small>${esc(label)}</small></div>`;

document.addEventListener('error', (e) => {
  if (e.target?.tagName === 'IMG') e.target.classList.add('broken');
}, true);

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-url]');
  if (link) { e.preventDefault(); call('shell:open', link.dataset.url).catch(() => {}); }
});
