/**
 * 卡片数据模型（纯函数，不碰 DOM / 存储 / UI）。
 */

export const STYLES = ['regular', 'secret', 'special'];

export const STYLE_LABELS = {
  regular: '常规',
  secret: '隐藏',
  special: '特别版',
};

/** 款式归一化：中文与大小写英文名都映射到规范值，未知值回退 regular。 */
function normalizeStyle(raw) {
  const s = String(raw ?? '').trim();
  const map = {
    '常规': 'regular',
    '隐藏': 'secret',
    '特别版': 'special',
  };
  const lower = s.toLowerCase();
  if (map[s] || STYLES.includes(lower)) {
    return map[s] || lower;
  }
  return 'regular';
}

/** 取正整数，非法时抛错。 */
function toPositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return n;
}

/** 本地日期 YYYY-MM-DD（不用 toISOString，避免 UTC 偏移）。 */
export function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 款式中文标签。 */
export function styleLabel(style) {
  return STYLE_LABELS[style] ?? STYLE_LABELS[STYLES.includes(style) ? style : 'regular'];
}

/**
 * 创建卡片：裁剪空白、补默认值、秒级 createdAt。
 * @param {object} input - series 必填，width/height 必填（正整数）
 * @param {{uuid?: () => string, now?: () => Date}} [deps] - 可注入依赖便于测试
 * @returns {{ id, series, character, style, pulledAt, note, width, height, createdAt }}
 */
export function createCard(input = {}, deps = {}) {
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date());

  const series = String(input.series ?? '').trim();
  if (!series) {
    throw new Error('系列不能为空');
  }
  const width = toPositiveInt(input.width, 'width');
  const height = toPositiveInt(input.height, 'height');
  const character = String(input.character ?? '').trim();
  const note = String(input.note ?? '').trim().slice(0, 200);
  const date = now();
  const pulledAt = input.pulledAt ?? formatLocalDate(date);

  return {
    id: uuid(),
    series,
    character,
    style: normalizeStyle(input.style),
    pulledAt,
    note,
    width,
    height,
    createdAt: Math.floor(date.getTime() / 1000),
  };
}

/**
 * 校验已持久化的卡对象形状，逐字段指出错误。
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateCardShape(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['不是对象'] };
  }

  if (typeof obj.id !== 'string' || !obj.id) {
    errors.push('id 缺失或为空');
  }
  if (typeof obj.series !== 'string' || !obj.series.trim()) {
    errors.push('series 缺失或为空');
  }
  if (!STYLES.includes(obj.style)) {
    errors.push(`style 不合法：${String(obj.style)}`);
  }
  // 注意：pulledAt / note / createdAt 不必查（可由绘制时间推导），核心契约字段见下。
  if (!Number.isInteger(obj.width) || obj.width <= 0) {
    errors.push('width 不是正整数');
  }
  if (!Number.isInteger(obj.height) || obj.height <= 0) {
    errors.push('height 不是正整数');
  }

  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors };
}
