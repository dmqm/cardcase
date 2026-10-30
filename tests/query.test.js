import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, listSeries, filterCards } from '../js/query.js';

const c = (id, series, style, createdAt) => ({ id, series, style, createdAt, character: '', pulledAt: '2026-10-29', note: '', width: 1, height: 1 });
const cards = [c('1', 'MEGA', 'secret', 3), c('2', 'MEGA', 'regular', 2), c('3', 'DIMOO', 'regular', 1)];

test('统计总数、系列数与隐藏数', () => {
  assert.deepEqual(computeStats(cards), { total: 3, seriesCount: 2, secretCount: 1 });
});

test('系列按数量降序', () => {
  assert.deepEqual(listSeries(cards), ['MEGA', 'DIMOO']);
});

test('按系列与款式筛选', () => {
  assert.deepEqual(filterCards(cards, { series: 'MEGA' }).map(x => x.id), ['1', '2']);
  assert.deepEqual(filterCards(cards, { style: 'secret' }).map(x => x.id), ['1']);
});

test('排序：recent 新到旧；series 按系列名再按时间', () => {
  assert.deepEqual(filterCards(cards, { sort: 'recent' }).map(x => x.id), ['1', '2', '3']);
  assert.deepEqual(filterCards(cards, { sort: 'series' }).map(x => x.id), ['3', '1', '2']);
});
