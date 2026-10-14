import assert from 'node:assert/strict';
import { test } from 'node:test';
import { squarify, wordsThatFit } from '../src/treemap-layout.ts';
import { groupByGenre, treemapHeight, type TreemapTile } from '../src/treemap-blocks.ts';

const frame = { x: 0, y: 0, width: 360, height: 600 };

test('ツリーマップ: 重みに比例した面積で枠を隙間なく埋め、 はみ出さない', () => {
  const weights = [6, 6, 4, 3, 2, 2, 1];
  const placed = squarify(weights, (w) => w, frame);
  assert.equal(placed.length, weights.length);
  const total = weights.reduce((a, b) => a + b, 0);
  for (const cell of placed) {
    assert.ok(Math.abs(cell.width * cell.height - (cell.item / total) * frame.width * frame.height) < 1e-6);
    assert.ok(cell.x >= -1e-9 && cell.y >= -1e-9);
    assert.ok(cell.x + cell.width <= frame.width + 1e-6 && cell.y + cell.height <= frame.height + 1e-6);
  }
  const area = placed.reduce((sum, cell) => sum + cell.width * cell.height, 0);
  assert.ok(Math.abs(area - frame.width * frame.height) < 1e-6);
  // 重なりが無い。
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      assert.ok(overlap < 1e-6, `${i} と ${j} が重なっています`);
    }
  }
});

test('ツリーマップ: 重みの大きい順に置き、 0 以下や空は置かない', () => {
  assert.deepEqual(squarify([], (w: number) => w, frame), []);
  assert.deepEqual(squarify([0, -1], (w) => w, frame), []);
  const placed = squarify([1, 5, 3], (w) => w, frame);
  assert.deepEqual(placed.map((cell) => cell.item), [5, 3, 1]);
});

test('ブロックに並べる注目ワードの数は広さに合わせ、 少なくとも 1 つ', () => {
  assert.equal(wordsThatFit({ x: 0, y: 0, width: 200, height: 200 }, 10, 3600, 6), 6);
  assert.equal(wordsThatFit({ x: 0, y: 0, width: 120, height: 60 }, 10, 3600, 6), 2);
  assert.equal(wordsThatFit({ x: 0, y: 0, width: 30, height: 30 }, 10, 3600, 6), 1);
  assert.equal(wordsThatFit({ x: 0, y: 0, width: 400, height: 400 }, 3, 3600, 6), 3);
});

test('ジャンルごとにまとめ、 興味の強い順に並べる。 話題の無いジャンルは出さない', () => {
  const tile = (key: string, genre: TreemapTile['genre'], interest: number, rank = 1): TreemapTile =>
    ({ key, title: key, url: null, genre, interest, rank, sourceName: 's' });
  const tiles = [tile('a', 'music', 0.2), tile('b', 'music', 0.9), tile('c', 'game', 0.5), tile('d', 'music', 0.9, 3)];
  const blocks = groupByGenre(tiles, [{ genre: 'music', label: '音楽' }, { genre: 'game', label: 'ゲーム' }, { genre: 'ai', label: 'AI' }]);
  assert.deepEqual(blocks.map((b) => b.genre.genre), ['music', 'game']);
  assert.deepEqual(blocks[0].tiles.map((t) => t.tile.key), ['b', 'd', 'a']);
  assert.deepEqual(blocks[0].tiles.map((t) => t.index), [1, 3, 0]);
  assert.ok(blocks[0].weight > blocks[1].weight);
});

test('全体の高さはブロックの数に合わせ、 幅の 1.2〜4 倍に収める', () => {
  assert.equal(treemapHeight(360, 1), 432);
  assert.equal(treemapHeight(360, 24), Math.round((24 * 17_000) / 360));
  assert.equal(treemapHeight(360, 200), 1440);
});
