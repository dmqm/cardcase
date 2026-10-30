import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHomography, applyHomography } from '../js/geom.js';

test('单位正方形映射到 200×300 矩形', () => {
  const m = computeHomography([[0,0],[1,0],[1,1],[0,1]], [[0,0],[200,0],[200,300],[0,300]]);
  assert.ok(m);
  const p = applyHomography(m, 0.5, 0.5);
  assert.ok(Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y - 150) < 1e-6);
});

test('恒等变换保持点不变', () => {
  const s = [[10,10],[110,10],[110,160],[10,160]];
  const p = applyHomography(computeHomography(s, s), 60, 85);
  assert.ok(Math.abs(p.x - 60) < 1e-6 && Math.abs(p.y - 85) < 1e-6);
});

test('退化输入（三点共线）返回 null', () => {
  assert.equal(computeHomography([[0,0],[1,1],[2,2],[0,1]], [[0,0],[1,0],[1,1],[0,1]]), null);
});
