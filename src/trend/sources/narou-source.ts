// 小説家になろうの公式 API (https://api.syosetu.com/novelapi/api/) の結果を順位付きの一覧に変える。
// 先頭要素は {allcount} なので飛ばす。 並び順 (order=dailypoint 等) はリクエスト URL で決める。

import type { RawTrendItem } from '../types.ts';

export const NAROU_API_HOST = 'api.syosetu.com';

/** 並び順 (order) ごとに、 表示するポイントの項目。 */
const POINT_BY_ORDER: Record<string, { key: string; label: string }> = {
  dailypoint: { key: 'daily_point', label: '日間' },
  weeklypoint: { key: 'weekly_point', label: '週間' },
  monthlypoint: { key: 'monthly_point', label: '月間' },
  hyoka: { key: 'global_point', label: '総合' },
};

export function narouOrder(sourceUrl: string): string {
  return new URL(sourceUrl).searchParams.get('order') ?? 'dailypoint';
}

/** JSON で、 作品名・Nコード・作者・各ポイントが返るよう out / of を付け直す (件数と並び順は URL のまま)。 */
export function narouRequestUrl(sourceUrl: string, limit: number): string {
  const url = new URL(sourceUrl);
  if (url.hostname !== NAROU_API_HOST) throw new Error(`小説家になろう API の URL ではありません: ${sourceUrl}`);
  url.searchParams.set('out', 'json');
  url.searchParams.set('of', 't-n-w-dp-wp-mp-gp');
  url.searchParams.set('lim', String(Math.min(Math.max(limit, 1), 50)));
  if (!url.searchParams.has('order')) url.searchParams.set('order', 'dailypoint');
  return url.toString();
}

function metricOf(entry: Record<string, unknown>, order: string): string | null {
  const field = POINT_BY_ORDER[order];
  if (!field) return null;
  const value = entry[field.key];
  return typeof value === 'number' ? `${field.label} ${value.toLocaleString('ja-JP')} pt` : null;
}

export function parseNarouRanking(json: string, limit: number, order = 'dailypoint'): RawTrendItem[] {
  let decoded: unknown;
  try { decoded = JSON.parse(json); } catch { throw new Error('小説家になろう API の応答が JSON ではありません'); }
  if (!Array.isArray(decoded)) throw new Error('小説家になろう API の応答が配列ではありません');
  const items: RawTrendItem[] = [];
  for (const raw of decoded) {
    if (items.length >= limit) break;
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    if (!title) continue; // 先頭の {allcount} など
    const ncode = typeof entry.ncode === 'string' && /^N[0-9A-Z]+$/i.test(entry.ncode) ? entry.ncode.toLowerCase() : null;
    const writer = typeof entry.writer === 'string' ? entry.writer.trim() : '';
    items.push({
      rank: items.length + 1,
      title: title.slice(0, 300),
      subtitle: writer ? writer.slice(0, 120) : null,
      url: ncode ? `https://ncode.syosetu.com/${ncode}/` : null,
      metric: metricOf(entry, order),
    });
  }
  return items;
}
