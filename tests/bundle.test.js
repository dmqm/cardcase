import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE_VERSION, createBundle, parseBundle, planMerge } from '../js/bundle.js';

const card = (id) => ({ id, series: 'S', character: '', style: 'regular', pulledAt: '2026-10-29',
  note: '', width: 1000, height: 1400, createdAt: 1 });

test('createBundle 生成 version 与图片', () => {
  const b = createBundle([card('a')], { a: 'data:image/webp;base64,AAA' }, '2026-10-29T00:00:00.000Z');
  assert.equal(b.version, BUNDLE_VERSION);
  assert.equal(b.cards[0].image, 'data:image/webp;base64,AAA');
  assert.equal(b.exportedAt, '2026-10-29T00:00:00.000Z');
});

test('缺图片的卡不进包', () => {
  assert.equal(createBundle([card('a')], {}, 'x').cards.length, 0);
});

test('parseBundle 拒绝坏包且给出中文原因', () => {
  assert.equal(parseBundle('not json').ok, false);
  assert.match(parseBundle(JSON.stringify({ version: 99, cards: [] })).error, /版本/);
  assert.match(parseBundle(JSON.stringify({ version: 1, cards: [{}] })).error, /字段/);
  const noImg = JSON.stringify({ version: 1, cards: [{ ...card('a'), image: 'http://x' }] });
  assert.match(parseBundle(noImg).error, /图片/);
});

test('planMerge 区分新增与覆盖', () => {
  const plan = planMerge(new Set(['a']), [card('a'), card('b')]);
  assert.equal(plan.overwritten.length, 1);
  assert.equal(plan.added.length, 1);
  assert.equal(plan.total, 2);
});
