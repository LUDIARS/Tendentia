// トレンド画面 > マップ表示 (スマホ)。 市場規模マップの形で、 ジャンルごとのブロックに注目ワードを並べる。
// 2026-10-14 neco「円は見にくかったのでスマホではジャンル別にブロック作る UI」「ブロックの中に注目ワードがいくつか並ぶ」。
// - ブロックの広さ = そのジャンルの上位の話題の重みの合計 (興味が強いジャンルほど広い)。
// - ブロックの中 = 興味の強い順に、 入るだけ (最大 6 つ、 ジャンルを絞ったときは 24) の話題を、 興味に比例した広さの四角で並べる。
// - 入りきらない分は「ほか n 件」。 押すとそのジャンルだけの表示になる。

import { genreHue, type TrendGenre } from './genres.ts';
import { escapeHtml } from './sanitize.ts';
import { groupByGenre, tileWeight, treemapHeight, type GenreBlock, type TreemapGenre, type TreemapTile } from './treemap-blocks.ts';
import { squarify, wordsThatFit, type Rect } from './treemap-layout.ts';

export interface TreemapOptions {
  /** 話題を開いたとき (開いた記録を送る)。 index は呼び出し元の tiles の位置。 */
  onOpen: (index: number) => void;
  /** 「ほか n 件」やジャンル名を押したとき。 */
  onSelectGenre: (genre: TrendGenre) => void;
}

const MAX_WORDS = 6;
/** ジャンルを 1 つに絞ったとき (ブロック 1 つが画面いっぱい) に並べる上限。 */
const MAX_WORDS_SINGLE = 24;
const HEADER_HEIGHT = 22;
/** 話題 1 つに要る最小の面積 (px²)。 これより狭くなるなら並べる数を減らす。 */
const MIN_WORD_AREA = 6000;
const FONT_SIZE = 12;
const LINE_HEIGHT = 1.3;
/** これより細いブロックでは「ほか n 件」を「+n」に縮める (ジャンル名を潰さないように)。 */
const NARROW_BLOCK = 140;
const GAP = 2;

function inset(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, width: Math.max(0, rect.width - by * 2), height: Math.max(0, rect.height - by * 2) };
}

function px(rect: Rect): string {
  return `left:${rect.x.toFixed(1)}px;top:${rect.y.toFixed(1)}px;width:${rect.width.toFixed(1)}px;height:${rect.height.toFixed(1)}px`;
}

function wordHtml(entry: { tile: TreemapTile; index: number }, rect: Rect): string {
  const { tile } = entry;
  // 四角の高さに入る行数だけ見せる (途中で切れた行を出さない)。 広い四角ほど少し大きな字にする。
  const size = rect.width * rect.height > 14_000 ? FONT_SIZE + 2 : FONT_SIZE;
  const lines = Math.max(1, Math.floor((rect.height - 6) / (size * LINE_HEIGHT)));
  const title = `${tile.title}\n${tile.sourceName} ${tile.rank}位 / 興味 ${Math.round(tile.interest * 100)}%`;
  const style = `${px(rect)};font-size:${size}px;--tt-lines:${lines};--tm-l:${Math.round(88 - 30 * Math.min(1, tile.interest))}%`;
  const inner = `<span class="tt-word-title">${escapeHtml(tile.title)}</span>`;
  const attrs = `class="tt-word" style="${style}" title="${escapeHtml(title)}" data-index="${entry.index}"`;
  return tile.url
    ? `<a ${attrs} href="${escapeHtml(tile.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
    : `<div ${attrs}>${inner}</div>`;
}

function blockHtml(block: GenreBlock, rect: Rect, maxWords: number): string {
  const inner = inset(rect, GAP);
  const words = { x: 0, y: HEADER_HEIGHT, width: inner.width, height: Math.max(0, inner.height - HEADER_HEIGHT) };
  const count = wordsThatFit(words, block.tiles.length, MIN_WORD_AREA, maxWords);
  const shown = block.tiles.slice(0, count);
  const more = block.tiles.length - shown.length;
  const placed = squarify(shown, (entry) => tileWeight(entry.tile), words);
  return `<section class="tt-block" style="${px(inner)};--tm-h:${genreHue(block.genre.genre)}">
    <button type="button" class="tt-block-head" data-genre="${block.genre.genre}" title="このジャンルだけ表示">
      <span>${escapeHtml(block.genre.label)}</span>${more > 0 ? `<span class="tt-more">${inner.width < NARROW_BLOCK ? `+${more}` : `ほか ${more} 件 ›`}</span>` : ''}
    </button>
    ${placed.map((cell) => wordHtml(cell.item, inset(cell, 1))).join('')}
  </section>`;
}

/** 画面の幅に合わせてブロックを敷き詰める。 高さは幅とブロックの数から決める (縦にスクロールする)。 */
export function renderTreemap(container: HTMLElement, tiles: readonly TreemapTile[], genres: readonly TreemapGenre[], options: TreemapOptions): void {
  const blocks = groupByGenre(tiles, genres);
  const width = Math.max(280, container.clientWidth);
  const height = treemapHeight(width, blocks.length);
  const placed = squarify(blocks, (block) => block.weight, { x: 0, y: 0, width, height });
  container.style.height = `${height}px`;
  const maxWords = blocks.length === 1 ? MAX_WORDS_SINGLE : MAX_WORDS;
  container.innerHTML = placed.map((cell) => blockHtml(cell.item, cell, maxWords)).join('');

  container.querySelectorAll<HTMLElement>('.tt-word[data-index]').forEach((element) => {
    element.addEventListener('click', () => options.onOpen(Number(element.dataset.index)));
  });
  container.querySelectorAll<HTMLButtonElement>('.tt-block-head[data-genre]').forEach((button) => {
    button.addEventListener('click', () => options.onSelectGenre(button.dataset.genre as TrendGenre));
  });
}
