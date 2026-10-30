// 应用入口：hash 路由 + 数据流。
// 启动时 listCards → renderGallery；筛选/排序变化写回 prefs 并重渲染；
// 删除流程：详情 → confirmDialog → deleteCard → 刷新统计。

import { listSeries } from './query.js';
import { deleteCard, listCards } from './db.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { closeDetail, confirmDialog, openDetail, renderGallery, toast } from './ui.js';

const VIEWS = ['gallery', 'data'];

function currentView() {
  const view = location.hash.replace(/^#\//, '');
  return VIEWS.includes(view) ? view : 'gallery';
}

function render() {
  const active = currentView();
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).hidden = view !== active;
  }
}

export function navigate(view) {
  location.hash = `#/${view}`;
}

window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', render);

let cards = [];
const cardsById = new Map();
let prefs = loadPrefs();

/** 局部更新 prefs（'' 视为"全部"→ null），写回并重渲染。 */
function setPrefs(patch) {
  const next = { ...prefs };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'sort') next.sort = value;
    else next[key] = value ? value : null;
  }
  prefs = next;
  savePrefs(prefs);
  renderAll();
}

/** 统一的重渲染入口；onChange 把筛选变化交回 app 写 prefs，再整页重渲染。 */
function renderAll() {
  renderGallery({
    cards,
    prefs,
    onChange(nextPatch) {
      setPrefs(nextPatch);
    },
  });
}

async function refresh() {
  cards = await listCards();
  cardsById.clear();
  for (const card of cards) cardsById.set(card.id, card);

  // 当前筛选的系列被删光时，自动回到"全部"，避免卡在空筛选上。
  if (prefs.series && !listSeries(cards).includes(prefs.series)) {
    prefs = { ...prefs, series: null };
    savePrefs(prefs);
  }

  renderAll();
}

async function removeCard(card) {
  const ok = await confirmDialog({
    title: '删除这张卡？',
    body: `「${card.series}」和它的图片会一起移出卡柜，无法恢复。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;

  try {
    await deleteCard(card.id);
  } catch (error) {
    toast(error?.message ?? '删除失败');
    return;
  }

  closeDetail();
  toast('已删除');
  await refresh();
}

// 全局点击委派：卡墙点击、筛选 chip、清除筛选都从这里接住（ui 只负责渲染）。
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-clear-filters]')) {
    setPrefs({ series: null, style: null });
    return;
  }

  const cardEl = event.target.closest('.card[data-id]');
  if (cardEl) {
    const card = cardsById.get(cardEl.dataset.id);
    if (card) openDetail(card, { onDelete: () => removeCard(card) });
    return;
  }

  const chip = event.target.closest('.chip[data-filter-type]');
  if (!chip) return;
  const type = chip.dataset.filterType;
  const value = chip.dataset.filterValue;
  if (type === 'series') setPrefs({ series: value });
  else if (type === 'style') setPrefs({ style: value });
  else if (type === 'sort') setPrefs({ sort: value });
});

refresh().catch((error) => toast(error?.message ?? '载入失败，请刷新重试'));
