// トレンド画面 > マップ表示。 市場規模マップの形で、 ジャンルごとのブロックに注目ワードを並べる (PC もスマホも同じ)。
// 色 = ジャンル、 広さ = 興味の度合い (全ジャンル共通の物差し。 trend-treemap-view.ts / treemap-blocks.ts)。
// 興味 = ジャンルごとの興味の強さ・気になる言葉 (自分で決める) × よく開くジャンル・話題 (開いた記録から学ぶ)。
// ジャンルは複数を組み合わせて選べ (既定は全部)、 その選び方を「マップ」として名前を付けて 5 つまで保存できる (クッキー)。

import { genreHue, type TrendGenre } from './genres.ts';
import {
  addMap, clearGenres, focusGenre, MAX_MAPS, MAX_NAME_LENGTH, presetsCookie, readPresetsCookie, removeMap, renameMap,
  selectAll, selectedGenres, switchMap, toggleGenre, type MapPresets,
} from './map-presets.ts';
import { escapeHtml } from './sanitize.ts';
import { renderTreemap } from './trend-treemap-view.ts';

type MovementStatus = 'new' | 'up' | 'down' | 'same' | 'unknown';

interface TrendInterestPrefs {
  genreWeights: Partial<Record<TrendGenre, number>>;
  keywords: string[];
}

interface TrendMapTile {
  key: string;
  title: string;
  subtitle: string | null;
  url: string | null;
  metric: string | null;
  genre: TrendGenre;
  sourceId: string;
  sourceName: string;
  rank: number;
  movement: { status: MovementStatus; delta: number | null };
  interest: number;
  reasons: string[];
}

interface TrendMapGenre {
  genre: TrendGenre;
  label: string;
  weight: number;
  count: number;
}

interface TrendMap {
  lastCrawledAt: string | null;
  prefs: TrendInterestPrefs;
  genres: TrendMapGenre[];
  tiles: TrendMapTile[];
}

const WEIGHT_STEPS: { value: number; label: string }[] = [
  { value: 0, label: 'ほぼ興味なし' },
  { value: 0.5, label: '少し' },
  { value: 1, label: 'ふつう' },
  { value: 2, label: '興味あり' },
  { value: 3, label: 'とても興味あり' },
];

let current: TrendMap | null = null;
let presets: MapPresets | null = null;
/** 名前を変えている途中のマップ (その見出しを入力欄にする)。 */
let renaming: number | null = null;
let root: HTMLElement | null = null;
/** 公開 URL からの閲覧 (ログインしていない) では false。 興味の設定と開いた記録を送らない。 */
let editable = true;
let resizeWatched = false;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

const allGenreIds = (map: TrendMap): string[] => map.genres.map((genre) => genre.genre);

/** マップの選び方を変えたら、 すぐクッキーに残して描き直す。 */
function update(next: MapPresets): void {
  presets = next;
  try {
    document.cookie = presetsCookie(next, location.protocol === 'https:');
  } catch { /* クッキーが使えなくても画面は動かす */ }
  render();
}

function weightOptions(weight: number): string {
  return WEIGHT_STEPS.map((step) =>
    `<option value="${step.value}"${step.value === weight ? ' selected' : ''}>${escapeHtml(step.label)}</option>`).join('');
}

function mapTabsHtml(state: MapPresets): string {
  const tabs = state.maps.map((preset, index) => {
    if (index === renaming) {
      return `<span class="tm-map-tab active"><input id="trendMapRename" type="text" maxlength="${MAX_NAME_LENGTH}" value="${escapeHtml(preset.name)}" aria-label="マップの名前">
        <button type="button" id="trendMapRenameSave" class="ghost">決定</button></span>`;
    }
    const active = index === state.active;
    return `<span class="tm-map-tab${active ? ' active' : ''}">
        <button type="button" class="tm-map-open" data-map="${index}">${escapeHtml(preset.name)}</button>
        ${active ? `<button type="button" class="tm-map-icon" data-rename="${index}" title="名前を変える" aria-label="名前を変える">✎</button>` : ''}
        ${active && state.maps.length > 1 ? `<button type="button" class="tm-map-icon" data-remove="${index}" title="このマップを消す" aria-label="このマップを消す">×</button>` : ''}
      </span>`;
  }).join('');
  const add = state.maps.length < MAX_MAPS
    ? `<button type="button" class="tm-map-add ghost" id="trendMapAdd" title="マップを足す (${MAX_MAPS} つまで)">＋ マップ</button>` : '';
  return `<div class="tm-maps" role="tablist" aria-label="保存したマップ">${tabs}${add}</div>`;
}

function legendHtml(map: TrendMap, selected: Set<string>): string {
  const chips = map.genres.map((genre) => `<div class="tm-legend-item">
      <button type="button" class="tm-chip${selected.has(genre.genre) ? ' active' : ''}" style="--tm-h:${genreHue(genre.genre)}" data-genre="${genre.genre}" aria-pressed="${selected.has(genre.genre)}" title="押すたびに選ぶ / 外す">${escapeHtml(genre.label)} <span class="muted">${genre.count}</span></button>
      <select class="tm-weight td-personal" data-genre="${genre.genre}" aria-label="${escapeHtml(genre.label)} の興味">${weightOptions(genre.weight)}</select>
    </div>`).join('');
  return `<div class="tm-legend">
    <button type="button" class="tm-chip tm-chip-all" id="trendMapAll">すべて</button>
    <button type="button" class="tm-chip tm-chip-all" id="trendMapClear">クリア</button>
    ${chips}
  </div>`;
}

function render(): void {
  if (!root || !current || !presets) return;
  const map = current;
  const selected = selectedGenres(presets.maps[presets.active], allGenreIds(map));
  const genres = map.genres.filter((genre) => selected.has(genre.genre));
  const hasTiles = map.tiles.some((tile) => selected.has(tile.genre));
  const body = map.tiles.length === 0
    ? '<div class="empty">まだトレンドがありません。「今すぐ巡回」を押すか、 次の自動巡回を待ってください。</div>'
    : hasTiles ? '<div class="tt-treemap" id="trendTreemap"></div>'
      : '<div class="empty">ジャンルが選ばれていません。 上のジャンルを押すか「すべて」を押してください。</div>';
  root.innerHTML = `<div class="tm-view foundation-form">
    ${mapTabsHtml(presets)}
    <p class="tm-help muted">色はジャンル、 広さは興味の度合いです。 ジャンルは押すたびに選ぶ / 外すを切り替え、 いくつでも組み合わせられます。 選び方はマップごとにこのブラウザへ保存されます。</p>
    ${legendHtml(map, selected)}
    <div class="tm-keywords td-personal">
      <label><span>気になる言葉 (読点・カンマ・改行で区切る)</span><input id="trendMapKeywords" type="text" maxlength="800" value="${escapeHtml(map.prefs.keywords.join('、'))}" placeholder="例: AI、ゲーム、ラーメン"></label>
      <button type="button" id="trendMapSaveKeywords">保存</button>
      <span id="trendMapStatus" class="muted"></span>
    </div>
    ${body}
  </div>`;
  bind();
  const treemap = document.getElementById('trendTreemap');
  if (treemap) {
    renderTreemap(treemap, map.tiles, genres, {
      onOpen: (index) => {
        const tile = map.tiles[index];
        if (tile && editable) recordClick(tile);
      },
      // ブロックのジャンル名を押すとそのジャンルだけ、 もう一度押すと全部に戻る。
      onSelectGenre: (genre) => { if (presets) update(focusGenre(presets, genre)); },
    });
  }
  document.getElementById('trendMapRename')?.focus();
}

function setStatus(text: string): void {
  const status = document.getElementById('trendMapStatus');
  if (status) status.textContent = text;
}

/** 開いた記録を送る。 リンクは別タブで開くので、 ページ遷移に巻き込まれないよう keepalive で投げっぱなしにする。 */
function recordClick(tile: TrendMapTile): void {
  void fetch('/api/trend-crawler/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: tile.key, genre: tile.genre, sourceId: tile.sourceId, title: tile.title.slice(0, 1000) }),
    keepalive: true,
  }).catch(() => { /* 記録できなくても表示は変えない */ });
}

async function savePrefs(next: TrendInterestPrefs): Promise<void> {
  setStatus('保存しています…');
  try {
    await request<TrendInterestPrefs>('/api/trend-crawler/interest', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    });
    await reload();
    setStatus('保存しました');
  } catch (error) {
    setStatus(`保存失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseKeywords(text: string): string[] {
  return [...new Set(text.split(/[、,，\n]/).map((word) => word.trim()).filter(Boolean))].slice(0, 50);
}

function finishRename(): void {
  const input = document.getElementById('trendMapRename') as HTMLInputElement | null;
  if (!presets || renaming === null || !input) return;
  const index = renaming;
  renaming = null;
  update(renameMap(presets, index, input.value));
}

function bindMaps(): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>('.tm-map-open[data-map]').forEach((button) => {
    button.addEventListener('click', () => { if (presets) update(switchMap(presets, Number(button.dataset.map))); });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-rename]').forEach((button) => {
    button.addEventListener('click', () => { renaming = Number(button.dataset.rename); render(); });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => { if (presets) update(removeMap(presets, Number(button.dataset.remove))); });
  });
  document.getElementById('trendMapAdd')?.addEventListener('click', () => { if (presets) update(addMap(presets)); });
  document.getElementById('trendMapRenameSave')?.addEventListener('click', finishRename);
  const input = document.getElementById('trendMapRename') as HTMLInputElement | null;
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finishRename();
    if (event.key === 'Escape') { renaming = null; render(); }
  });
}

function bind(): void {
  if (!root || !current) return;
  const map = current;
  bindMaps();
  root.querySelectorAll<HTMLButtonElement>('.tm-chip[data-genre]').forEach((button) => {
    button.addEventListener('click', () => {
      if (presets) update(toggleGenre(presets, button.dataset.genre ?? '', allGenreIds(map)));
    });
  });
  document.getElementById('trendMapAll')?.addEventListener('click', () => { if (presets) update(selectAll(presets)); });
  document.getElementById('trendMapClear')?.addEventListener('click', () => { if (presets) update(clearGenres(presets)); });
  root.querySelectorAll<HTMLSelectElement>('.tm-weight').forEach((select) => {
    select.addEventListener('change', () => {
      if (!current) return;
      const genre = select.dataset.genre as TrendGenre;
      const weights = { ...current.prefs.genreWeights, [genre]: Number(select.value) };
      void savePrefs({ ...current.prefs, genreWeights: weights });
    });
  });
  document.getElementById('trendMapSaveKeywords')?.addEventListener('click', () => {
    if (!current) return;
    const input = document.getElementById('trendMapKeywords') as HTMLInputElement | null;
    void savePrefs({ ...current.prefs, keywords: parseKeywords(input?.value ?? '') });
  });
}

async function reload(): Promise<void> {
  const response = await request<{ map: TrendMap }>('/api/trend-crawler/map');
  current = response.map;
  presets ??= readPresetsCookie(document.cookie, allGenreIds(current));
  render();
}

export async function loadTrendMap(container: HTMLElement, canEdit = true): Promise<void> {
  root = container;
  editable = canEdit;
  if (!resizeWatched) {
    // 画面の幅が変わったらブロックを敷き直す (向きの変更・ウィンドウの大きさ)。 続けて来る分はまとめる。
    resizeWatched = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(() => { if (renaming === null) render(); }, 200);
    });
  }
  try {
    await reload();
  } catch (error) {
    container.innerHTML = `<div class="empty">読み込み失敗: ${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  }
}
