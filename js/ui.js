// UI 层：展馆渲染（统计 / 筛选条 / 卡墙）、卡片详情、toast 与确认框。
// 这里只做展示与交互壳，数据流（prefs 持久化、删除）由 app.js 驱动。

import { styleLabel } from './model.js';
import { computeStats, listSeries, filterCards } from './query.js';
import { getImage } from './db.js';

/* ---------- 小工具 ---------- */

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function cardLabel(card) {
  return [card.series, card.character].filter(Boolean).join(' · ');
}

/** 格式化 'YYYY-MM-DD' → '10 月 29 日'；入参不合法时原样返回。 */
export function formatDate(date) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(date ?? ''));
  if (!match) return String(date ?? '');
  return `${Number(match[2])} 月 ${Number(match[3])} 日`;
}

/* ---------- 图片对象 URL 生命周期 ---------- */

// 卡墙与详情各用一组 URL；每次重渲染 / 关闭详情时收回上一批，避免泄漏。
let gridSeq = 0;
let detailSeq = 0;
const gridUrls = new Set();
const detailUrls = new Set();

function revokeUrls(urls) {
  for (const url of urls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* URL 已失效，忽略 */
    }
  }
  urls.clear();
}

/* ---------- 底部轻提示 ---------- */

let toastEl = null;
let toastTimer = null;

export function toast(message) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    toastEl.className = 'toast';
    toastEl.setAttribute('aria-live', 'polite');
    document.body.append(toastEl);
  }
  toastEl.textContent = String(message ?? '');
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

/* ---------- 确认框 ---------- */

let dialogResolve = null;

function ensureConfirmOverlay() {
  let overlay = document.getElementById('confirm-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'confirm-overlay';
  overlay.className = 'confirm-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 class="confirm-title" id="confirm-title"></h2>
      <p class="confirm-body"></p>
      <div class="confirm-actions">
        <button type="button" class="btn" data-confirm-action="cancel">取消</button>
        <button type="button" class="btn btn-confirm" data-confirm-action="confirm">确认</button>
      </div>
    </div>`;
  document.body.append(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      settleConfirm(false);
      return;
    }
    const action = event.target.closest('[data-confirm-action]')?.dataset.confirmAction;
    if (action) settleConfirm(action === 'confirm');
  });
  return overlay;
}

function settleConfirm(value) {
  const resolve = dialogResolve;
  dialogResolve = null;
  const overlay = document.getElementById('confirm-overlay');
  if (overlay) overlay.hidden = true;
  resolve?.(value);
}

export function confirmDialog({ title, body, confirmText = '确认', danger = false } = {}) {
  return new Promise((resolve) => {
    // 同一时刻只保留一个确认框：上一个未决的直接按取消处理。
    if (dialogResolve) settleConfirm(false);

    const overlay = ensureConfirmOverlay();
    overlay.querySelector('.confirm-title').textContent = String(title ?? '');
    overlay.querySelector('.confirm-body').textContent = String(body ?? '');
    const confirmBtn = overlay.querySelector('[data-confirm-action="confirm"]');
    confirmBtn.textContent = String(confirmText ?? '确认');
    confirmBtn.classList.toggle('danger', Boolean(danger));

    dialogResolve = resolve;
    overlay.hidden = false;
    overlay.querySelector('[data-confirm-action="cancel"]').focus();
  });
}

/* ---------- 展馆渲染 ---------- */

const STYLE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'regular', label: styleLabel('regular') },
  { value: 'secret', label: styleLabel('secret') },
  { value: 'special', label: styleLabel('special') },
];

const SORT_OPTIONS = [
  { value: 'recent', label: '最近' },
  { value: 'series', label: '按系列' },
];

function chip(type, value, active, label) {
  return `<button type="button" class="chip" aria-pressed="${active ? 'true' : 'false'}" data-filter-type="${esc(type)}" data-filter-value="${esc(value)}">${esc(label)}</button>`;
}

/**
 * 渲染展馆：顶部统计、筛选条、卡墙；空柜时只显示空态。
 * @param {{ cards: Array, prefs: object, onChange?: (patch: object) => void }} params
 */
export function renderGallery({ cards, prefs, onChange = null } = {}) {
  const seq = ++gridSeq;
  // 重渲染前收回上一批图片 URL，避免泄漏。
  revokeUrls(gridUrls);

  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('empty-state');
  const stats = computeStats(cards);

  setText('stat-total', stats.total);
  setText('stat-series', stats.seriesCount);
  setText('stat-secret', stats.secretCount);

  let bar = document.getElementById('filter-bar');
  if (stats.total === 0) {
    if (bar) bar.hidden = true;
    emptyState.hidden = false;
    grid.hidden = true;
    grid.innerHTML = '';
    return;
  }

  emptyState.hidden = true;

  if (!bar) {
    bar = document.createElement('nav');
    bar.id = 'filter-bar';
    bar.className = 'filter-bar';
    emptyState.parentNode.insertBefore(bar, emptyState);
  }
  bar.hidden = false;

  const current = {
    series: prefs?.series ?? null,
    style: prefs?.style ?? null,
    sort: prefs?.sort ?? 'recent',
  };

  const seriesNames = listSeries(cards);
  bar.innerHTML = `
    <div class="filter-row" role="group" aria-label="按系列筛选">
      ${chip('series', '', current.series == null, '全部系列')}
      ${seriesNames.map((name) => chip('series', name, current.series === name, name)).join('')}
    </div>
    <div class="filter-row" role="group" aria-label="按款式筛选">
      ${STYLE_OPTIONS.map((opt) => chip('style', opt.value, (current.style ?? '') === opt.value, opt.label)).join('')}
    </div>
    <div class="filter-row" role="group" aria-label="排序方式">
      ${SORT_OPTIONS.map((opt) => chip('sort', opt.value, current.sort === opt.value, opt.label)).join('')}
    </div>`;

  const visibleCards = filterCards(cards, current);
  grid.hidden = false;

  if (visibleCards.length === 0) {
    // 柜子中有卡但当前筛选筛空了：留一句提示，不误报"空柜"。
    grid.innerHTML = `
      <p class="grid-note">
        没有符合当前筛选的卡片。
        <button type="button" class="chip" data-clear-filters>清除筛选</button>
      </p>`;
    return;
  }

  grid.innerHTML = visibleCards.map((card) => `
    <button type="button" class="card${card.style === 'secret' ? ' is-secret' : ''}" data-id="${esc(card.id)}" aria-label="${esc(cardLabel(card))}">
      <img alt="${esc(cardLabel(card))}">
    </button>`).join('');

  // 图片懒补充：blob → objectURL，重渲染并发时用 seq 判掉过期结果。
  for (const card of visibleCards) {
    getImage(card.id)
      .then((blob) => {
        if (seq !== gridSeq || !blob) return;
        const img = grid.querySelector(`[data-id="${CSS.escape(card.id)}"] img`);
        if (!img) return;
        const url = URL.createObjectURL(blob);
        gridUrls.add(url);
        img.src = url;
      })
      .catch(() => {
        /* 图片缺失时保留 --case 底衬，不打断渲染 */
      });
  }
}

/* ---------- 卡片详情 ---------- */

let detailContext = null; // { card, onDelete }

function wireDetailOnce() {
  const section = document.getElementById('view-detail');
  if (!section || section.dataset.wired === '1') return;
  section.dataset.wired = '1';

  section.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'close') closeDetail();
    if (action === 'edit') toast('编辑功能即将上线');
    if (action === 'delete') detailContext?.onDelete?.();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !section.hidden) closeDetail();
  });
}

function wireConfirmOverlayEscape() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const overlay = document.getElementById('confirm-overlay');
    if (overlay && !overlay.hidden) settleConfirm(false);
  });
}

export function openDetail(card, { onDelete = null } = {}) {
  wireConfirmOverlayEscape();
  wireDetailOnce();

  const section = document.getElementById('view-detail');
  detailContext = { card, onDelete };
  const seq = ++detailSeq;

  const character = card.character?.trim() ? esc(card.character) : '未填写';
  const note = card.note?.trim() ? esc(card.note) : '未填写';

  section.innerHTML = `
    <article class="detail-card">
      <div class="detail-media${card.style === 'secret' ? ' is-secret' : ''}">
        <img alt="${esc(cardLabel(card))}">
      </div>
      <h2 class="detail-series">${esc(card.series)}</h2>
      <dl class="detail-fields">
        <div><dt>角色</dt><dd>${character}</dd></div>
        <div><dt>款式</dt><dd class="${card.style === 'secret' ? 'label-secret' : ''}">${esc(styleLabel(card.style))}</dd></div>
        <div><dt>日期</dt><dd>${esc(formatDate(card.pulledAt))}</dd></div>
        <div><dt>备注</dt><dd>${note}</dd></div>
      </dl>
      <div class="detail-actions">
        <button type="button" class="btn" data-action="edit">编辑</button>
        <button type="button" class="btn btn-danger" data-action="delete">删除</button>
        <button type="button" class="btn btn-primary" data-action="close">关闭</button>
      </div>
    </article>`;
  section.hidden = false;

  getImage(card.id)
    .then((blob) => {
      if (seq !== detailSeq || !blob) return;
      const img = section.querySelector('.detail-media img');
      if (!img) return;
      const url = URL.createObjectURL(blob);
      detailUrls.add(url);
      img.src = url;
    })
    .catch(() => {
      /* 图片缺失时保留底衬 */
    });
}

export function closeDetail() {
  detailContext = null;
  detailSeq += 1;
  const section = document.getElementById('view-detail');
  if (!section) return;
  section.hidden = true;
  section.innerHTML = '';
  revokeUrls(detailUrls);
}
