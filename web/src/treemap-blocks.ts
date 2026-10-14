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

/** 興味 0 の話題も小さく残す (消えない)。 */
const TILE_BASE = 0.35;
/** 1 ジャンルの広さに数える話題の数 (話題の多いジャンルが画面を占めないように)。 */
const GENRE_WEIGHT_TOP = 6;

export const tileWeight = (tile: TreemapTile): number => TILE_BASE + Math.min(1, Math.max(0, tile.interest));

export interface GenreBlock {
  genre: TreemapGenre;
  tiles: { tile: TreemapTile; index: number }[];
  weight: number;
}

/** ジャンルごとにまとめ、 話題は興味の強い順に並べる。 */
export function groupByGenre(tiles: readonly TreemapTile[], genres: readonly TreemapGenre[]): GenreBlock[] {
  return genres.map((genre) => {
    const entries = tiles.map((tile, index) => ({ tile, index }))
      .filter((entry) => entry.tile.genre === genre.genre)
      .sort((a, b) => b.tile.interest - a.tile.interest || a.tile.rank - b.tile.rank);
    const weight = entries.slice(0, GENRE_WEIGHT_TOP).reduce((sum, entry) => sum + tileWeight(entry.tile), 0);
    return { genre, tiles: entries, weight };
  }).filter((block) => block.tiles.length > 0);
}

/** 1 ブロックあたりの目安の面積 (px²)。 ジャンル名と注目ワード 2〜3 つが読める広さ。 */
const BLOCK_AREA = 17_000;

/** 全体の高さ。 ブロックの数 × 目安の面積を幅で割る (少なくとも幅の 1.2 倍、 多くても 4 倍)。 */
export function treemapHeight(width: number, blocks: number): number {
  return Math.round(Math.min(width * 4, Math.max(width * 1.2, (blocks * BLOCK_AREA) / width)));
}
