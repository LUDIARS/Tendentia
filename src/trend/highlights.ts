// ジャンルごとの「注目」を決まったルールで選ぶ (LLM は使わない)。 DB を知らない純関数。
//
// 候補: 複数のサイトで話題 (cross)・新登場 (new)・3 位以上の急上昇 (up)。
// 並べ方: 理由の重み (cross 3 / new 2 / up 1) の合計 → 順位の高い順。 同じ話題は 1 つにまとめる。

import type { TrendHighlight, TrendHighlightReason, TrendSourceView } from './types.ts';

export const HIGHLIGHTS_PER_GENRE = 3;
/** これ未満の順位上昇は「急上昇」と呼ばない。 */
const MIN_UP_DELTA = 3;
const WEIGHT: Record<TrendHighlightReason, number> = { cross: 3, new: 2, up: 1 };

export function pickHighlights(
  sources: TrendSourceView[],
  crossKeys: ReadonlySet<string>,
  limit = HIGHLIGHTS_PER_GENRE,
): TrendHighlight[] {
  const byKey = new Map<string, TrendHighlight & { score: number }>();
  for (const source of sources) {
    for (const item of source.items) {
      const reasons: TrendHighlightReason[] = [];
      if (crossKeys.has(item.key)) reasons.push('cross');
      if (item.movement.status === 'new') reasons.push('new');
      if (item.movement.status === 'up' && (item.movement.delta ?? 0) >= MIN_UP_DELTA) reasons.push('up');
      if (reasons.length === 0) continue;
      const score = reasons.reduce((sum, reason) => sum + WEIGHT[reason], 0);
      const current = byKey.get(item.key);
      if (current && (current.score > score || (current.score === score && current.rank <= item.rank))) continue;
      byKey.set(item.key, { title: item.title, url: item.url, sourceName: source.name, rank: item.rank, reasons, score });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, limit)
    .map(({ score: _score, ...highlight }) => highlight);
}
