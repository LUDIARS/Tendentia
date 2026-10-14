// ツリーマップ (市場規模マップの形) の割り付け。 重みに比例した面積の長方形で、 与えた枠を隙間なく埋める。
// squarified (Bruls ほか) で、 なるべく正方形に近い形を選ぶ。 DOM に触らない純関数 (テストできるように分けている)。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placed<T> extends Rect {
  item: T;
}

/** 1 列 (1 行) に並べたときの最も細長い比 (1 が正方形)。 */
function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((total, area) => total + area, 0);
  if (sum <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const sideSq = side * side;
  return Math.max((sideSq * max) / (sum * sum), (sum * sum) / (sideSq * min));
}

/**
 * 重み (0 より大きい値) に比例した面積で frame を埋める。 重みの大きい順に置く。
 * 重みが 0 以下のものは置かない。
 */
export function squarify<T>(items: readonly T[], weightOf: (item: T) => number, frame: Rect): Placed<T>[] {
  const weighted = items.map((item) => ({ item, weight: weightOf(item) }))
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (weighted.length === 0 || frame.width <= 0 || frame.height <= 0) return [];
  const scale = (frame.width * frame.height) / totalWeight;
  const queue = weighted.map((entry) => ({ item: entry.item, area: entry.weight * scale }));

  const placed: Placed<T>[] = [];
  let rest: Rect = { ...frame };
  let row: typeof queue = [];

  const layoutRow = (): void => {
    const rowArea = row.reduce((sum, entry) => sum + entry.area, 0);
    const horizontal = rest.width >= rest.height; // 短い辺に沿って列を立てる
    if (horizontal) {
      const width = rest.height > 0 ? rowArea / rest.height : 0;
      let y = rest.y;
      for (const entry of row) {
        const height = width > 0 ? entry.area / width : 0;
        placed.push({ item: entry.item, x: rest.x, y, width, height });
        y += height;
      }
      rest = { x: rest.x + width, y: rest.y, width: Math.max(0, rest.width - width), height: rest.height };
    } else {
      const height = rest.width > 0 ? rowArea / rest.width : 0;
      let x = rest.x;
      for (const entry of row) {
        const width = height > 0 ? entry.area / height : 0;
        placed.push({ item: entry.item, x, y: rest.y, width, height });
        x += width;
      }
      rest = { x: rest.x, y: rest.y + height, width: rest.width, height: Math.max(0, rest.height - height) };
    }
    row = [];
  };

  for (const entry of queue) {
    const side = Math.min(rest.width, rest.height);
    const current = row.map((r) => r.area);
    if (row.length === 0 || worstRatio([...current, entry.area], side) <= worstRatio(current, side)) {
      row.push(entry);
    } else {
      layoutRow();
      row.push(entry);
    }
  }
  if (row.length > 0) layoutRow();
  return placed;
}

/** 面積に応じて、 ブロックの中に並べる注目ワードの数を決める (小さいブロックに詰め込まない)。 */
export function wordsThatFit(rect: Rect, available: number, minCellArea: number, max: number): number {
  const byArea = Math.floor((rect.width * rect.height) / minCellArea);
  return Math.max(1, Math.min(available, max, byArea));
}
