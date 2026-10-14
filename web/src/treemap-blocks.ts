// スマホのマップ (ジャンル別ブロック) の、 DOM に触らない部分: 話題のジャンル分け・重み・全体の高さ。
// 描画は trend-treemap-view.ts。 テストできるように分けている。

import type { TrendGenre } from './genres.ts';

export interface TreemapTile {
  key: string;
  title: string;
  url: string | null;
  genre: TrendGenre;
  interest: number;
  rank: number;
  sourceName: string;
}

export interface TreemapGenre {
  genre: TrendGenre;
  label: string;
}

// 大きさに差をつける (2026-10-14 neco「大きさに差をつけて欲しい」)。 興味は上位がどれも 0.7〜1 に固まるので、
// そのまま比例させると全部同じ大きさになる。 ワードは興味の 4 乗、 ブロックは全話題の興味の 2 乗の合計で広さを決める
// (話題が多く注目の強いジャンルほど広い = 市場規模マップの「規模」)。

/** 興味 0 の話題も小さく残す (消えない)。 */
const TILE_FLOOR = 0.03;
/** これより狭いブロックは作らない (中央のジャンルの広さに対する割合)。 ジャンル名とワード 1 つが読めるように。 */
const BLOCK_FLOOR_OF_MEDIAN = 0.35;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const tileWeight = (tile: TreemapTile): number => TILE_FLOOR + clamp01(tile.interest) ** 4;

export interface GenreBlock {
  genre: TreemapGenre;
  tiles: { tile: TreemapTile; index: number }[];
  weight: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** ジャンルごとにまとめ、 話題は興味の強い順に並べる。 ブロックの重みは全話題の興味の 2 乗の合計 (小さすぎるものは底上げ)。 */
export function groupByGenre(tiles: readonly TreemapTile[], genres: readonly TreemapGenre[]): GenreBlock[] {
  const blocks = genres.map((genre) => {
    const entries = tiles.map((tile, index) => ({ tile, index }))
      .filter((entry) => entry.tile.genre === genre.genre)
      .sort((a, b) => b.tile.interest - a.tile.interest || a.tile.rank - b.tile.rank);
    const weight = entries.reduce((sum, entry) => sum + TILE_FLOOR + clamp01(entry.tile.interest) ** 2, 0);
    return { genre, tiles: entries, weight };
  }).filter((block) => block.tiles.length > 0);
  if (blocks.length < 2) return blocks;
  const floor = median(blocks.map((block) => block.weight)) * BLOCK_FLOOR_OF_MEDIAN;
  return blocks.map((block) => ({ ...block, weight: Math.max(block.weight, floor) }));
}

/** 1 ブロックあたりの目安の面積 (px²)。 ジャンル名と注目ワード 2〜3 つが読める広さ。 */
const BLOCK_AREA = 17_000;

/** 全体の高さ。 ブロックの数 × 目安の面積を幅で割る (少なくとも幅の 1.2 倍、 多くても 4 倍)。 */
export function treemapHeight(width: number, blocks: number): number {
  return Math.round(Math.min(width * 4, Math.max(width * 1.2, (blocks * BLOCK_AREA) / width)));
}
