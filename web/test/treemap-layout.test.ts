import assert from 'node:assert/strict';
import { test } from 'node:test';
import { squarify, squarifyReadable, wordsThatFit } from '../src/treemap-layout.ts';
import { groupByGenre, tileWeight, treemapHeight, type TreemapTile } from '../src/treemap-blocks.ts';

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

test('大きさに差をつける: ワードは興味の 4 乗、 ブロックは全話題の興味の 2 乗の合計で、 小さすぎるブロックは底上げする', () => {
  const tile = (key: string, genre: TreemapTile['genre'], interest: number): TreemapTile =>
    ({ key, title: key, url: null, genre, interest, rank: 1, sourceName: 's' });
  // 興味 0.97 と 0.69 (上位に多い値) でも、 ワードの広さは 2.5 倍以上違う。
  assert.ok(tileWeight(tile('a', 'tech', 0.97)) / tileWeight(tile('b', 'tech', 0.69)) > 2.5);
  assert.ok(tileWeight(tile('z', 'tech', 0)) > 0);
  // 話題が多く興味の強いジャンルほど広い。 話題の少ないジャンルは中央の 35% まで底上げ。
  const tiles = [
    ...Array.from({ length: 40 }, (_, i) => tile(`t${i}`, 'tech', 0.8)),
    ...Array.from({ length: 20 }, (_, i) => tile(`g${i}`, 'game', 0.8)),
    ...Array.from({ length: 10 }, (_, i) => tile(`m${i}`, 'music', 0.8)),
    tile('b0', 'book', 0.3),
  ];
  const blocks = groupByGenre(tiles, (['tech', 'game', 'music', 'book'] as const).map((genre) => ({ genre, label: genre })));
  const weight = (genre: string) => blocks.find((b) => b.genre.genre === genre)!.weight;
  assert.ok(weight('tech') > weight('game') && weight('game') > weight('music'));
  assert.ok(Math.abs(weight('tech') / weight('game') - 2) < 0.01);
  const median = (weight('game') + weight('music')) / 2;
  assert.ok(Math.abs(weight('book') - median * 0.35) < 1e-9);
});

test('全体の高さはブロックの数に合わせ、 幅の 1.2〜4 倍に収める', () => {
  assert.equal(treemapHeight(360, 1), 432);
  assert.equal(treemapHeight(360, 24), Math.round((24 * 17_000) / 360));
  assert.equal(treemapHeight(360, 200), 1440);
});

test('細すぎる四角ができるなら並べる数を減らし、 少なくとも 1 つは置く', () => {
  const box = { x: 0, y: 0, width: 120, height: 100 };
  const weights = [1, 0.05, 0.05, 0.05];
  // そのまま 4 つ置くと小さい 3 つが細くなる。
  assert.ok(squarify(weights, (w) => w, box).some((cell) => cell.width < 40 || cell.height < 30));
  const placed = squarifyReadable(weights, (w) => w, box, 4, 40, 30);
  assert.ok(placed.length >= 1 && placed.length < 4);
  assert.ok(placed.every((cell) => cell.width >= 40 && cell.height >= 30) || placed.length === 1);
  assert.equal(squarifyReadable(weights, (w) => w, { x: 0, y: 0, width: 10, height: 10 }, 4, 40, 30).length, 1);
});
