/**
 * 导出包格式、校验与合并计划（纯函数，不碰 DOM / 存储）。
 */

import { validateCardShape } from './model.js';

export const BUNDLE_VERSION = 1;

/** 只接受内嵌的 data:image/... 图片。 */
function isDataImage(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * 生成导出包，只保留有内嵌图片的卡。
 * @param {object[]} cards
 * @param {Record<string, string>} imageDataUrlById
 * @param {string} exportedAt
 */
export function createBundle(cards, imageDataUrlById = {}, exportedAt) {
  const kept = [];
  for (const card of cards) {
    const image = imageDataUrlById ? imageDataUrlById[card.id] : undefined;
    if (isDataImage(image)) {
      kept.push({ ...card, image });
    }
  }
  return { version: BUNDLE_VERSION, exportedAt, cards: kept };
}

/**
 * 整包校验：任何一项失败都不返回部分结果。
 * @returns {{ ok: true, bundle: object } | { ok: false, error: string }}
 */
export function parseBundle(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是有效的导出文件' };
  }

  if (!data || typeof data !== 'object' || data.version !== BUNDLE_VERSION) {
    return { ok: false, error: '不支持的导出文件版本' };
  }
  if (!Array.isArray(data.cards)) {
    return { ok: false, error: '文件里有卡片字段不完整' };
  }
  for (const card of data.cards) {
    if (!validateCardShape(card).ok) {
      return { ok: false, error: '文件里有卡片字段不完整' };
    }
  }
  for (const card of data.cards) {
    if (!isDataImage(card.image)) {
      return { ok: false, error: '卡片图片缺失或格式不对' };
    }
  }

  return { ok: true, bundle: data };
}

/**
 * 按 id 归类导入的卡：已存在即覆盖，否则新增。
 * @param {Set<string>} existingIds
 * @param {object[]} incoming
 */
export function planMerge(existingIds, incoming) {
  const added = [];
  const overwritten = [];
  for (const card of incoming) {
    if (existingIds && existingIds.has(card.id)) {
      overwritten.push(card);
    } else {
      added.push(card);
    }
  }
  return { added, overwritten, total: incoming.length };
}
