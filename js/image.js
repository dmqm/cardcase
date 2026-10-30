/**
 * 图片解码与透视压缩：file → ImageBitmap → 校正后的 ≤150KB Blob。
 * 只做平台层（canvas / File / Blob），不碰 UI、不写库。
 */

import { computeHomography } from './geom.js';

const DECODE_MAX_EDGE = 2400;
const SIZE_LIMIT = 150 * 1024;

/** 卡片目标画布尺寸：短边对齐 outLongEdge，长边按 aspect（宽/高）取整。默认 63:88 竖版 → 1000×1397。 */
export function outputSize(outLongEdge = 1000, aspect = 63 / 88) {
  const edge = Math.max(1, Math.round(outLongEdge));
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 63 / 88;
  if (ratio >= 1) {
    // 横版：高是短边，宽延伸。
    return { width: Math.max(1, Math.round(edge * ratio)), height: edge };
  }
  // 竖版：宽是短边，高延伸。
  return { width: edge, height: Math.max(1, Math.round(edge / ratio)) };
}

/**
 * 解码用户选的文件为 ImageBitmap（带 EXIF 方向）。
 * 长边超过 2400px 时先画到离屏 canvas 降采样，避免大图打爆内存。
 */
export async function decodeFile(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('这张图读不出来，换一张试试');
    }
  }

  const edge = Math.max(bitmap.width, bitmap.height);
  if (edge <= DECODE_MAX_EDGE) return bitmap;

  try {
    const scale = DECODE_MAX_EDGE / edge;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return await createImageBitmap(canvas);
  } catch {
    // 降采样失败时用原 bitmap 继续，别把能用的图拦在门外。
    return bitmap;
  }
}

/** 双线性采样：带边界钳制，fx/fy 越界时取边缘像素。 */
function sampleBilinear(src, sw, sh, fx, fy, out, o) {
  const x = fx < 0 ? 0 : fx > sw - 1 ? sw - 1 : fx;
  const y = fy < 0 ? 0 : fy > sh - 1 ? sh - 1 : fy;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < sw ? x0 + 1 : sw - 1;
  const y1 = y0 + 1 < sh ? y0 + 1 : sh - 1;
  const ax = x - x0;
  const ay = y - y0;
  const i00 = (y0 * sw + x0) * 4;
  const i10 = (y0 * sw + x1) * 4;
  const i01 = (y1 * sw + x0) * 4;
  const i11 = (y1 * sw + x1) * 4;
  for (let k = 0; k < 4; k++) {
    const top = src[i00 + k] + (src[i10 + k] - src[i00 + k]) * ax;
    const bottom = src[i01 + k] + (src[i11 + k] - src[i01 + k]) * ax;
    out[o + k] = top + (bottom - top) * ay;
  }
}

function encodeCanvas(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 按校正四角重投影并压缩。
 * @param {ImageBitmap} bitmap 源图
 * @param {Array<[number,number]>} corners 源图上的 4 点（左上→右上→右下→左下）
 * @param {number} [outLongEdge=1000] 目标短边
 * @param {number} [aspect=63/88] 目标宽高比（竖版 63/88，横版 88/63）
 * @returns {Promise<Blob>} image/webp q0.8（不支持时 image/jpeg q0.85），超 150KB 用 q0.65 重编一次
 */
export async function warpToBlob(bitmap, corners, outLongEdge = 1000, aspect = 63 / 88) {
  if (!corners || corners.length !== 4) {
    throw new Error('四个角没摆好，重新对一下');
  }

  const { width, height } = outputSize(outLongEdge, aspect);
  const targetCorners = [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]];

  // 目标 → 源的映射：逐目标像素反查源坐标，避免空洞。
  const m = computeHomography(targetCorners, corners);
  if (!m) throw new Error('四个角没摆好，重新对一下');

  const sw = bitmap.width;
  const sh = bitmap.height;
  const stage = document.createElement('canvas');
  stage.width = sw;
  stage.height = sh;
  stage.getContext('2d').drawImage(bitmap, 0, 0);
  const src = stage.getContext('2d').getImageData(0, 0, sw, sh).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  const out = outCtx.createImageData(width, height);
  const pixels = out.data;

  // 行主序单应矩阵内联展开计算，1.4M 像素逐点反查。
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const wCol = m[6] * u + m[7] * v + m[8];
      const o = (v * width + u) * 4;
      if (Math.abs(wCol) < 1e-12) continue; // 落在无穷远 → 保持透明
      const sx = (m[0] * u + m[1] * v + m[2]) / wCol;
      const sy = (m[3] * u + m[4] * v + m[5]) / wCol;
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
      sampleBilinear(src, sw, sh, sx, sy, pixels, o); // alpha 随源一起插值
    }
  }
  outCtx.putImageData(out, 0, 0);

  let blob = await encodeCanvas(outCanvas, 'image/webp', 0.8);
  const isWebp = Boolean(blob && blob.type === 'image/webp');
  if (!isWebp) {
    blob = await encodeCanvas(outCanvas, 'image/jpeg', 0.85);
  }
  if (!blob || blob.size === 0) throw new Error('图片压缩失败');

  if (blob.size > SIZE_LIMIT) {
    const smaller = await encodeCanvas(outCanvas, isWebp ? 'image/webp' : 'image/jpeg', 0.65);
    if (smaller && smaller.size < blob.size) blob = smaller;
  }
  return blob;
}

/** Blob → data URL（base64）。 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) {
      reject(new Error('没有可读的图片数据'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

/** data URL → Blob（base64 或 URL 编码都认）。 */
export function dataUrlToBlob(url) {
  const text = String(url ?? '');
  const comma = text.indexOf(',');
  if (comma === -1 || !/^data:/i.test(text)) {
    throw new Error('不是合法的 data URL');
  }
  const head = text.slice(0, comma);
  const mime = /data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const body = text.slice(comma + 1);

  if (/;base64/i.test(head)) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}
