// 透视校正几何内核：4 点对应求单应矩阵 + 齐次坐标变换。
// 无外部依赖。

const AREA_EPS = 1e-6;
const PIVOT_EPS = 1e-12;

function shoelaceArea(quad) {
  let sum = 0;
  for (let i = 0; i < quad.length; i++) {
    const [x1, y1] = quad[i];
    const [x2, y2] = quad[(i + 1) % quad.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// 带部分主元的高斯消元，解 A·h = b。奇异则返回 null。
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < PIVOT_EPS) return null;
    if (pivot !== col) {
      const tmp = M[pivot];
      M[pivot] = M[col];
      M[col] = tmp;
    }
    const pv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }

  const h = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * h[c];
    h[r] = s / M[r][r];
  }
  return h;
}

/**
 * 由 4 组对应点求 3×3 单应矩阵（行主序长度 9，h33 归一化为 1）。
 * @param {number[][]} src 4 个 [x, y]
 * @param {number[][]} dst 4 个 [x, y]，与 src 顺序对应
 * @returns {number[]|null} 退化时 null
 */
export function computeHomography(src, dst) {
  if (!Array.isArray(src) || !Array.isArray(dst) || src.length !== 4 || dst.length !== 4) return null;

  if (Math.abs(shoelaceArea(src)) < AREA_EPS) return null;
  if (Math.abs(shoelaceArea(dst)) < AREA_EPS) return null;

  // 未知量 h = [h11,h12,h13,h21,h22,h23,h31,h32]，h33 = 1
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * 齐次坐标变换。
 * @param {number[]} m 行主序 3×3
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}} w 接近 0 时返回 NaN
 */
export function applyHomography(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  if (Math.abs(w) < 1e-12) return { x: NaN, y: NaN };
  const px = m[0] * x + m[1] * y + m[2];
  const py = m[3] * x + m[4] * y + m[5];
  return { x: px / w, y: py / w };
}
