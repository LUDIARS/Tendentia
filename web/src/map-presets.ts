// マップの保存 (2026-10-14 neco「マップをカスタマイズ可能にして 5 つまで保存」「マップ名を変更できる、 フィルタをクッキーに保存」)。
// 1 つのマップ = 名前 + 選んだジャンル。 全部をクッキー 1 つ (td_maps) に JSON で持つ。 ログインは要らない。
// DOM に触らない部分 (形の確認・追加・名前変更・削除・ジャンルの選び方) をここに置き、 クッキーの読み書きは最後の 2 つの関数だけ。

export const MAX_MAPS = 5;
export const MAX_NAME_LENGTH = 20;
export const COOKIE_NAME = 'td_maps';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** genres が 'all' なら全ジャンル (新しいジャンルが増えても入る)。 配列なら選んだものだけ (空 = クリア)。 */
export interface MapPreset {
  name: string;
  genres: 'all' | string[];
}

export interface MapPresets {
  active: number;
  maps: MapPreset[];
}

export function defaultPresets(): MapPresets {
  return { active: 0, maps: [{ name: 'マップ 1', genres: 'all' }] };
}

function cleanName(name: unknown, fallback: string): string {
  const text = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '';
  return text || fallback;
}

/** クッキーの中身を確かめて取り込む。 壊れていれば既定に戻す (表示は止めない)。 */
export function parsePresets(raw: string | null | undefined, knownGenres: readonly string[]): MapPresets {
  if (!raw) return defaultPresets();
  try {
    const value = JSON.parse(raw) as { active?: unknown; maps?: unknown };
    if (!Array.isArray(value.maps) || value.maps.length === 0) return defaultPresets();
    const maps = value.maps.slice(0, MAX_MAPS).map((entry, index): MapPreset => {
      const item = (entry ?? {}) as { name?: unknown; genres?: unknown };
      const genres = item.genres === 'all' || !Array.isArray(item.genres)
        ? 'all'
        : [...new Set(item.genres.filter((genre): genre is string => typeof genre === 'string' && knownGenres.includes(genre)))];
      return { name: cleanName(item.name, `マップ ${index + 1}`), genres };
    });
    const active = Number.isInteger(value.active) && (value.active as number) >= 0 && (value.active as number) < maps.length ? value.active as number : 0;
    return { active, maps };
  } catch {
    return defaultPresets();
  }
}

export function serializePresets(presets: MapPresets): string {
  return JSON.stringify(presets);
}

/** そのマップで選ばれているジャンル。 */
export function selectedGenres(preset: MapPreset, allGenres: readonly string[]): Set<string> {
  return new Set(preset.genres === 'all' ? allGenres : preset.genres.filter((genre) => allGenres.includes(genre)));
}

function withActive(presets: MapPresets, update: (preset: MapPreset) => MapPreset): MapPresets {
  return { ...presets, maps: presets.maps.map((preset, index) => (index === presets.active ? update(preset) : preset)) };
}

/** ジャンルを 1 つ選ぶ / 外す (複数を組み合わせられる)。 全部そろったら 'all' に戻す。 */
export function toggleGenre(presets: MapPresets, genre: string, allGenres: readonly string[]): MapPresets {
  return withActive(presets, (preset) => {
    const selected = selectedGenres(preset, allGenres);
    if (selected.has(genre)) selected.delete(genre);
    else selected.add(genre);
    const genres = allGenres.every((g) => selected.has(g)) ? 'all' : allGenres.filter((g) => selected.has(g));
    return { ...preset, genres };
  });
}

export function selectAll(presets: MapPresets): MapPresets {
  return withActive(presets, (preset) => ({ ...preset, genres: 'all' }));
}

export function clearGenres(presets: MapPresets): MapPresets {
  return withActive(presets, (preset) => ({ ...preset, genres: [] }));
}

/** そのジャンルだけにする。 既にそのジャンルだけなら全部に戻す。 */
export function focusGenre(presets: MapPresets, genre: string): MapPresets {
  return withActive(presets, (preset) => ({
    ...preset,
    genres: Array.isArray(preset.genres) && preset.genres.length === 1 && preset.genres[0] === genre ? 'all' : [genre],
  }));
}

/** 新しいマップを足して開く (5 つまで)。 中身は全ジャンル。 */
export function addMap(presets: MapPresets): MapPresets {
  if (presets.maps.length >= MAX_MAPS) return presets;
  const used = new Set(presets.maps.map((preset) => preset.name));
  let number = presets.maps.length + 1;
  while (used.has(`マップ ${number}`)) number += 1;
  const maps = [...presets.maps, { name: `マップ ${number}`, genres: 'all' as const }];
  return { active: maps.length - 1, maps };
}

export function renameMap(presets: MapPresets, index: number, name: string): MapPresets {
  if (index < 0 || index >= presets.maps.length) return presets;
  return { ...presets, maps: presets.maps.map((preset, i) => (i === index ? { ...preset, name: cleanName(name, preset.name) } : preset)) };
}

/** マップを消す。 最後の 1 つは消さない。 */
export function removeMap(presets: MapPresets, index: number): MapPresets {
  if (presets.maps.length <= 1 || index < 0 || index >= presets.maps.length) return presets;
  const maps = presets.maps.filter((_, i) => i !== index);
  const active = presets.active > index || presets.active >= maps.length ? Math.max(0, presets.active - 1) : presets.active;
  return { active, maps };
}

export function switchMap(presets: MapPresets, index: number): MapPresets {
  return index >= 0 && index < presets.maps.length ? { ...presets, active: index } : presets;
}

/** document.cookie から読む。 */
export function readPresetsCookie(cookie: string, knownGenres: readonly string[]): MapPresets {
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === COOKIE_NAME) {
      try { return parsePresets(decodeURIComponent(part.slice(index + 1).trim()), knownGenres); } catch { return defaultPresets(); }
    }
  }
  return defaultPresets();
}

/** document.cookie に書く値 (1 年、 このサイトだけ)。 */
export function presetsCookie(presets: MapPresets, secure: boolean): string {
  return `${COOKIE_NAME}=${encodeURIComponent(serializePresets(presets))}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
