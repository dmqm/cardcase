// 整柜导出 / 导入：数据页的核心动作。
// 这里只做读库 → 组包 → 下载，与 选文件 → 校验 → 征询 → 写库，
// 界面事件绑定在 app.js。

import { createBundle, parseBundle, planMerge } from './bundle.js';
import { getImage, importReplace, listCards, saveCard } from './db.js';
import { blobToDataUrl, dataUrlToBlob } from './image.js';
import { formatLocalDate } from './model.js';
import { confirmDialog, toast } from './ui.js';

const BIG_BUNDLE_BYTES = 15 * 1024 * 1024; // 超过这个体量，先问一句再导

/** 字节数 → 人话：874 B / 128.0 KB / 3.2 MB。 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 估算整柜导出后的 JSON 体积（图片按 base64 膨胀 4/3 计）。
 * 用于按钮旁的「约 X」文字，不用真的生成 data URL，开销很小。
 */
export async function estimateExportSize() {
  const cards = await listCards();
  let imageBytes = 0;
  for (const card of cards) {
    const blob = await getImage(card.id);
    if (blob) imageBytes += blob.size * (4 / 3);
  }
  // 元数据 + JSON 结构 + exportedAt 的粗略开销，宁多勿少。
  return Math.round(imageBytes + cards.length * 400 + 80);
}

/**
 * 导出整柜：读全部卡与图片 → data URL → 组包 → 下载。
 * 超过 15MB 先经 confirmDialog 征询；缺图的卡跳过并在结束时 toast。
 * @returns {Promise<{ filename: string | null, size: number }>}
 */
export async function exportAll() {
  const cards = await listCards();

  const imageDataUrlById = {};
  let missing = 0;
  for (const card of cards) {
    const blob = await getImage(card.id);
    if (!blob) { missing += 1; continue; }
    try {
      imageDataUrlById[card.id] = await blobToDataUrl(blob);
    } catch {
      missing += 1; // 单张图读不出来不该拦住整柜备份
    }
  }

  const text = JSON.stringify(createBundle(cards, imageDataUrlById, new Date().toISOString()));
  const size = new Blob([text]).size;

  if (size > BIG_BUNDLE_BYTES) {
    const ok = await confirmDialog({
      title: '备份文件比较大',
      body: `估算约 ${formatBytes(size)}，生成和保存都会慢一些，还要留出手机存储空间。继续导出吗？`,
      confirmText: '继续导出',
    });
    if (!ok) return { filename: null, size };
  }

  const filename = `cardcase-${formatLocalDate(new Date())}.json`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  if (missing > 0) toast(`有 ${missing} 张卡没有图片，已跳过`);
  return { filename, size };
}

/**
 * 导入备份文件：整包校验 → planMerge 预览 → 征询 → 写库。
 * 任何一步失败都不写库（replace 的整柜清空+写入在用户确认后、同一事务内原子完成）。
 * @param {File} file
 * @param {'merge'|'replace'} mode
 * @returns {Promise<{ ok: boolean, written?: number, total?: number, error?: string, cancelled?: boolean }>}
 */
export async function importFile(file, mode) {
  let text;
  try {
    text = await file.text();
  } catch {
    toast('文件读不出来，换一个试试');
    return { ok: false, error: '文件读取失败' };
  }

  const parsed = parseBundle(text);
  if (!parsed.ok) {
    toast(parsed.error); // 坏包整包拒绝，数据库一个字节都没动
    return { ok: false, error: parsed.error };
  }

  const incoming = parsed.bundle.cards;
  const existing = await listCards();
  const existingIds = new Set(existing.map((card) => card.id));
  const plan = planMerge(existingIds, incoming);

  const ok = await confirmDialog({
    title: mode === 'replace' ? '用备份替换全部？' : '合并导入这份备份？',
    body: mode === 'replace'
      ? `现有的 ${existing.length} 张卡会全部删除，再写入文件里的 ${plan.total} 张。删掉的照片无法找回。`
      : `新增 ${plan.added.length} 张 / 覆盖 ${plan.overwritten.length} 张。同名卡的信息会被文件里的版本取代。`,
    confirmText: mode === 'replace' ? '替换' : '导入',
    danger: mode === 'replace',
  });
  if (!ok) return { ok: false, cancelled: true };

  if (mode === 'replace') {
    // 替换：整体原子写入。任一步失败事务 abort，旧柜原样保留。
    const entries = [...plan.added, ...plan.overwritten].map((card) => {
      const blob = dataUrlToBlob(card.image);
      const { image, ...meta } = card;
      return { card: meta, blob };
    });
    try {
      await importReplace(entries);
    } catch (error) {
      toast(error?.message ?? '导入失败，原有卡片未改动');
      return { ok: false, written: 0, error: error?.message ?? '写入失败' };
    }
    return { ok: true, written: entries.length, total: plan.total };
  }

  let written = 0;
  try {
    for (const card of [...plan.added, ...plan.overwritten]) {
      const blob = dataUrlToBlob(card.image);
      const { image, ...meta } = card;
      await saveCard(meta, blob);
      written += 1;
    }
  } catch (error) {
    toast(`导入中断，已写入的 ${written} 张保留`);
    return { ok: false, written, error: error?.message ?? '写入失败' };
  }
  return { ok: true, written, total: plan.total };
}
