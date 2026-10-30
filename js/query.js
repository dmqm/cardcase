// 卡片统计、系列列表与筛选排序（纯函数，不改入参）
const LOCALE = 'zh-Hans-CN';

export function computeStats(cards) {
  const series = new Set();
  let secretCount = 0;
  for (const card of cards) {
    if (card.series != null) series.add(card.series);
    if (card.style === 'secret') secretCount += 1;
  }
  return { total: cards.length, seriesCount: series.size, secretCount };
}

export function listSeries(cards) {
  const counts = new Map();
  for (const card of cards) {
    if (card.series == null) continue;
    counts.set(card.series, (counts.get(card.series) || 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => {
    const diff = counts.get(b) - counts.get(a);
    if (diff !== 0) return diff;
    return String(a).localeCompare(String(b), LOCALE);
  });
}

export function filterCards(cards, { series = null, style = null, sort = 'recent' } = {}) {
  let out = cards.slice();
  if (series != null) out = out.filter((card) => card.series === series);
  if (style != null) out = out.filter((card) => card.style === style);

  const byRecent = (a, b) => {
    const diff = (b.createdAt ?? 0) - (a.createdAt ?? 0);
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id), LOCALE);
  };

  if (sort === 'series') {
    out.sort((a, b) => {
      const diff = String(a.series ?? '').localeCompare(String(b.series ?? ''), LOCALE);
      if (diff !== 0) return diff;
      return byRecent(a, b);
    });
  } else {
    out.sort(byRecent);
  }
  return out;
}
