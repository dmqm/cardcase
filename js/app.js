// 应用入口：hash 路由 + 数据流。
// 启动时 listCards → renderGallery；筛选/排序变化写回 prefs 并重渲染；
// 删除流程：详情 → confirmDialog → deleteCard → 刷新统计。

import { listSeries } from './query.js';
import { clearAll, deleteCard, listCards } from './db.js';
import { clearPrefs, loadPrefs, savePrefs } from './prefs.js';
import { closeDetail, confirmDialog, openDetail, renderGallery, toast } from './ui.js';
import { openImport } from './import-flow.js';
import { estimateExportSize, exportAll, formatBytes, importFile } from './transfer.js';

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
  if (active === 'data') updateExportSize();
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

document.getElementById('fab-import')?.addEventListener('click', () => {
  openImport({ onSaved: refresh });
});

/* ---------- 数据页：导出 / 导入 / 清空 ---------- */

const CLEAR_WORD = '清空';
let clearConfirmBusy = false; // 二次确认期间锁住，避免连点

/** 按钮旁的估算体积文字；估算失败就留空，别挡住按钮。 */
let estimatingSize = false;
function updateExportSize() {
  if (estimatingSize) return;
  estimatingSize = true;
  estimateExportSize()
    .then((bytes) => setTextIfExists('data-export-size', `约 ${formatBytes(bytes)}`))
    .catch(() => { /* 读库失败时静默，下次进入再试 */ })
    .finally(() => { estimatingSize = false; });
}

function setTextIfExists(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function runExport() {
  try {
    const { filename, size } = await exportAll();
    if (filename) {
      setTextIfExists('data-export-size', `约 ${formatBytes(size)}`);
      toast(`已导出 ${filename}`);
    }
  } catch (error) {
    toast(error?.message ?? '导出失败，再试一次');
  }
}

let importMode = 'merge';
let importing = false;

/** 点导入按钮只决定模式，真正的文件在 input.change 里接住。 */
function pickImportFile(mode) {
  if (importing) return;
  importMode = mode;
  document.getElementById('data-import-input')?.click();
}

async function runImport(file) {
  if (!file || importing) return;
  importing = true;
  try {
    const result = await importFile(file, importMode);
    if (result.ok) {
      toast(`已导入 ${result.written} 张`);
      await refresh();
    }
  } catch (error) {
    toast(error?.message ?? '导入失败，再试一次');
  } finally {
    importing = false;
  }
}

async function runClearAll() {
  if (clearConfirmBusy) return;
  clearConfirmBusy = true;
  try {
    if (cards.length > 0) {
      const ok = await confirmDialog({
        title: '清空整个卡柜？',
        body: `${cards.length} 张卡和它们的图片会被全部删掉，操作无法恢复。`,
        confirmText: '确认清空',
        danger: true,
      });
      if (!ok) return;
    }
    await clearAll();
    clearPrefs();
    prefs = loadPrefs(); // 模块缓存同步回默认，别让旧筛选挂在内存里
    resetClearInput();
    toast('卡柜已清空');
    navigate('gallery'); // 回默认视图
    await refresh();
  } catch (error) {
    toast(error?.message ?? '清空失败，再试一次');
  } finally {
    clearConfirmBusy = false;
  }
}

function resetClearInput() {
  const input = document.getElementById('data-clear-confirm');
  const button = document.getElementById('btn-clear-all');
  if (input) input.value = '';
  if (button) button.disabled = true;
}

function wireDataView() {
  const view = document.getElementById('view-data');
  if (!view || view.dataset.wired === '1') return;
  view.dataset.wired = '1';

  document.getElementById('btn-export')?.addEventListener('click', runExport);

  document.getElementById('btn-import-merge')?.addEventListener('click', () => pickImportFile('merge'));
  document.getElementById('btn-import-replace')?.addEventListener('click', () => pickImportFile('replace'));

  const importInput = document.getElementById('data-import-input');
  importInput?.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = ''; // 允许重复选同一个文件
    runImport(file);
  });

  const clearInput = document.getElementById('data-clear-confirm');
  const clearButton = document.getElementById('btn-clear-all');
  // 必须真的打出「清空」两个字，按钮才解锁。
  clearInput?.addEventListener('input', () => {
    clearButton.disabled = clearInput.value.trim() !== CLEAR_WORD;
  });
  clearButton?.addEventListener('click', () => {
    if (clearButton.disabled) return;
    runClearAll();
  });
}

wireDataView();

refresh().catch((error) => toast(error?.message ?? '载入失败，请刷新重试'));

/* ---------- 离线：Service Worker 注册 ---------- */
// 注册失败静默 —— 没网也没 SW 就当普通网页用，别打断主流程。

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const httpsLike = location.protocol === 'https:' || location.hostname === 'localhost';
  if (!httpsLike) return;

  navigator.serviceWorker.register('./sw.js').then((registration) => {
    // 新 SW 已激活（skipWaiting+claim 路径），提示用户刷新拿新版。
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' && navigator.serviceWorker.controller) {
          toast('新版本已就绪，刷新后生效');
        }
      });
    });
  }).catch(() => { /* 注册失败不提示 */ });
}

window.addEventListener('load', registerServiceWorker);
