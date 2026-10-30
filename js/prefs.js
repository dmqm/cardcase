/**
 * 偏好设置：localStorage 持久化，字段逐项校验并回落默认值。
 * localStorage 不可用（隐私模式 / 被禁用）时静默降级为内存对象。
 */

const KEY = 'cardcase.prefs';
const SORTS = ['recent', 'series'];
const MOTIONS = ['auto', 'off'];

export const DEFAULT_PREFS = Object.freeze({
  series: null,
  style: null,
  sort: 'recent',
  motion: 'auto',
});

/** 内存兜底，localStorage 抛错时用它保持会话内状态。 */
let memory = { ...DEFAULT_PREFS };

/** 取 localStorage；不可用或访问抛错时返回 null。 */
function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 归一化：类型不对的字段逐项回落默认值。 */
function normalizePrefs(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    series: typeof src.series === 'string' ? src.series : null,
    style: typeof src.style === 'string' ? src.style : null,
    sort: SORTS.includes(src.sort) ? src.sort : 'recent',
    motion: MOTIONS.includes(src.motion) ? src.motion : 'auto',
  };
}

/** 读取偏好；缺 key / 解析失败 / 类型不对都回落默认值。 */
export function loadPrefs() {
  const storage = getStorage();
  if (!storage) return { ...memory };

  let raw = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return { ...memory };
  }

  if (raw === null) {
    memory = { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    memory = { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS };
  }

  const prefs = normalizePrefs(parsed);
  memory = { ...prefs };
  return prefs;
}

/** 归一化后写回。 */
export function savePrefs(prefs) {
  const normalized = normalizePrefs(prefs);
  memory = { ...normalized };

  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(normalized));
  } catch {
    /* 隐私模式 / 配额不足：静默降级为内存对象 */
  }
}

/** 删除持久化 key，并重置内存兜底。 */
export function clearPrefs() {
  memory = { ...DEFAULT_PREFS };

  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    /* 静默降级 */
  }
}
