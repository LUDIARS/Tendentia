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

// 大きさは全ジャンルでまとめて 1 回決める (2026-10-14 neco「大きさに差をつけて欲しい」「全カテゴリで一回まとめてブロックの
// 大きさ決めて欲しい」)。 ワード 1 つの広さは所属ジャンルに関係なく興味だけで決め (興味の 4 乗。 興味は上位がどれも 0.7〜1 に
// 固まるので差を広げる)、 ブロックの広さはそのブロックに並べるワードの広さの合計 + 見出しの分にする (市場規模マップと同じ)。
// そのため同じ興味のワードは、 どのジャンルのブロックにあってもほぼ同じ大きさになる。

/** 興味 0 の話題も小さく残す (消えない)。 */
const TILE_FLOOR = 0.03;
/** ジャンル名の見出しに使う広さ (ワードの合計に対する割合)。 */
const HEADER_SHARE = 0.2;
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

/**
 * ジャンルごとにまとめ、 話題は興味の強い順に並べる。 ブロックの重みは、 並べる上位 wordsPerBlock 件のワードの重みの
 * 合計 + 見出しの分 (全ジャンル共通の物差し)。 小さすぎるものだけ読める広さまで底上げする。
 */
export function groupByGenre(tiles: readonly TreemapTile[], genres: readonly TreemapGenre[], wordsPerBlock = 6): GenreBlock[] {
  const blocks = genres.map((genre) => {
    const entries = tiles.map((tile, index) => ({ tile, index }))
      .filter((entry) => entry.tile.genre === genre.genre)
      .sort((a, b) => b.tile.interest - a.tile.interest || a.tile.rank - b.tile.rank);
    const words = entries.slice(0, wordsPerBlock).reduce((sum, entry) => sum + tileWeight(entry.tile), 0);
    return { genre, tiles: entries, weight: words * (1 + HEADER_SHARE) };
  }).filter((block) => block.tiles.length > 0);
  if (blocks.length < 2) return blocks;
  const floor = median(blocks.map((block) => block.weight)) * BLOCK_FLOOR_OF_MEDIAN;
  return blocks.map((block) => ({ ...block, weight: Math.max(block.weight, floor) }));
}

/** 重み 1 (興味が最大) のワード 1 つに使う面積 (px²)。 だいたい 100 × 100。 全ジャンル共通の物差し。 */
const UNIT_AREA = 10_000;

/** 全体の高さ。 ブロックの重みの合計 × 物差しの面積を幅で割る (少なくとも幅の 1.2 倍、 多くても 6 倍)。 */
export function treemapHeight(width: number, totalWeight: number): number {
  return Math.round(Math.min(width * 6, Math.max(width * 1.2, (totalWeight * UNIT_AREA) / width)));
}
