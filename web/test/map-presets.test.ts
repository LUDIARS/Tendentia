import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMap, clearGenres, defaultPresets, focusGenre, MAX_MAPS, parsePresets, presetsCookie, readPresetsCookie, removeMap, renameMap,
  selectAll, selectedGenres, serializePresets, switchMap, toggleGenre,
} from '../src/map-presets.ts';

const ALL = ['tech', 'game', 'music', 'ai'];

test('既定は 1 つのマップで全ジャンルが選ばれている', () => {
  const presets = defaultPresets();
  assert.equal(presets.maps.length, 1);
  assert.deepEqual([...selectedGenres(presets.maps[0], ALL)], ALL);
});

test('ジャンルは押すたびに選ぶ / 外すを切り替え、 複数を組み合わせられる。 「すべて」「クリア」もある', () => {
  let presets = defaultPresets();
  presets = toggleGenre(presets, 'game', ALL);
  assert.deepEqual(presets.maps[0].genres, ['tech', 'music', 'ai']);
  presets = toggleGenre(presets, 'music', ALL);
  assert.deepEqual(presets.maps[0].genres, ['tech', 'ai']);
  presets = toggleGenre(presets, 'game', ALL);
  assert.deepEqual(presets.maps[0].genres, ['tech', 'game', 'ai']);
  presets = toggleGenre(presets, 'music', ALL);
  assert.equal(presets.maps[0].genres, 'all');
  presets = clearGenres(presets);
  assert.deepEqual(presets.maps[0].genres, []);
  assert.equal(selectedGenres(presets.maps[0], ALL).size, 0);
  presets = toggleGenre(presets, 'ai', ALL);
  assert.deepEqual(presets.maps[0].genres, ['ai']);
  assert.equal(selectAll(presets).maps[0].genres, 'all');
});

test('ジャンルだけに絞り、 もう一度で全部に戻る', () => {
  let presets = focusGenre(defaultPresets(), 'music');
  assert.deepEqual(presets.maps[0].genres, ['music']);
  presets = focusGenre(presets, 'music');
  assert.equal(presets.maps[0].genres, 'all');
});

test('マップは 5 つまで足せて、 名前を変え、 消せる (最後の 1 つは消さない)。 開くマップを切り替えられる', () => {
  let presets = defaultPresets();
  for (let i = 0; i < 10; i += 1) presets = addMap(presets);
  assert.equal(presets.maps.length, MAX_MAPS);
  assert.equal(presets.active, MAX_MAPS - 1);
  assert.deepEqual(presets.maps.map((m) => m.name), ['マップ 1', 'マップ 2', 'マップ 3', 'マップ 4', 'マップ 5']);
  presets = renameMap(presets, 1, '  ゲームとAI  ');
  assert.equal(presets.maps[1].name, 'ゲームとAI');
  assert.equal(renameMap(presets, 1, '   ').maps[1].name, 'ゲームとAI');
  assert.equal(renameMap(presets, 1, 'あ'.repeat(40)).maps[1].name.length, 20);
  presets = switchMap(presets, 1);
  presets = toggleGenre(presets, 'tech', ALL);
  assert.deepEqual(presets.maps[1].genres, ['game', 'music', 'ai']);
  assert.equal(presets.maps[0].genres, 'all');
  presets = removeMap(presets, 0);
  assert.equal(presets.maps[0].name, 'ゲームとAI');
  assert.equal(presets.active, 0);
  let one = defaultPresets();
  one = removeMap(one, 0);
  assert.equal(one.maps.length, 1);
  // 消したあと、 足すと空いた番号の名前になる。
  assert.equal(addMap(removeMap(addMap(defaultPresets()), 1)).maps[1].name, 'マップ 2');
});

test('クッキーに保存して読み戻せ、 壊れた値・知らないジャンル・多すぎるマップは整える', () => {
  let presets = addMap(toggleGenre(defaultPresets(), 'tech', ALL));
  presets = renameMap(presets, 1, '音楽だけ');
  presets = clearGenres(presets);
  presets = toggleGenre(presets, 'music', ALL);
  const cookie = presetsCookie(presets, true);
  assert.match(cookie, /^td_maps=.+; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/);
  const value = cookie.split(';')[0];
  assert.deepEqual(readPresetsCookie(`a=1; ${value}; b=2`, ALL), presets);
  assert.deepEqual(readPresetsCookie('a=1', ALL), defaultPresets());
  assert.deepEqual(parsePresets('{broken', ALL), defaultPresets());
  const odd = parsePresets(JSON.stringify({ active: 9, maps: [{ name: '', genres: ['tech', 'unknown', 'tech'] }, ...Array(8).fill({ name: 'x', genres: 'all' })] }), ALL);
  assert.equal(odd.maps.length, MAX_MAPS);
  assert.equal(odd.active, 0);
  assert.deepEqual(odd.maps[0], { name: 'マップ 1', genres: ['tech'] });
  assert.equal(parsePresets(serializePresets(presets), ALL).maps[1].name, '音楽だけ');
});
