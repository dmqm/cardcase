import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard, validateCardShape, formatLocalDate, styleLabel } from '../js/model.js';

test('createCard 补齐默认值并裁剪空白', () => {
  const card = createCard({ series: '  SKULLPANDA  ', width: 1000, height: 1400 },
    { uuid: () => 'id-1', now: () => new Date(2026, 9, 29, 23, 30) });
  assert.equal(card.id, 'id-1');
  assert.equal(card.series, 'SKULLPANDA');
  assert.equal(card.character, '');
  assert.equal(card.style, 'regular');
  assert.equal(card.pulledAt, '2026-10-29');
  assert.equal(card.createdAt, Math.floor(new Date(2026, 9, 29, 23, 30).getTime() / 1000));
});

test('系列为空时抛错', () => {
  assert.throws(() => createCard({ series: '   ', width: 1, height: 1 }), /系列/);
});

test('款式容错：中文与未知值', () => {
  assert.equal(createCard({ series: 'A', style: '隐藏', width: 1, height: 1 }).style, 'secret');
  assert.equal(createCard({ series: 'A', style: '乱写', width: 1, height: 1 }).style, 'regular');
  assert.equal(styleLabel('secret'), '隐藏');
});

test('pulledAt 用本地日期，不受 UTC 影响', () => {
  assert.equal(formatLocalDate(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('validateCardShape 指出缺哪些字段', () => {
  assert.deepEqual(validateCardShape({ id: 'x', series: 'A', style: 'regular', width: 1, height: 1 }).ok, true);
  const bad = validateCardShape({ id: '', series: '', style: 'nope', width: 0, height: 1 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 3);
});
