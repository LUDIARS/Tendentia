// 本社 (collector) から AWS (viewer) へトレンドの履歴を写す「複製」の型。
// collector が GET /api/sync/export で差分を出し、 viewer が取りに行って自分の DB へ入れる。
// データは全公開 (2026-10-14 neco「秘匿物ないので全公開で良い」) なので、 読み出しに秘密の値は使わない。
// マップで開いた記録 (trend_clicks) は閲覧の行動そのものなので写さない (本社の DB に閉じる)。

export interface SyncSnapshot {
  id: number;
  source_id: string;
  genre: string;
  fetched_at: string;
  ok: number;
  error: string | null;
}

export interface SyncItem {
  snapshot_id: number;
  rank: number;
  title: string;
  subtitle: string | null;
  url: string | null;
  metric: string | null;
  item_key: string;
}

export interface SyncSetting {
  key: string;
  value: string | null;
}

/** 1 回の書き出し。 cursor は「ここまで渡した」の位置 (次はこれより後を頼む)。 */
export interface SyncExport {
  version: 1;
  snapshots: SyncSnapshot[];
  items: SyncItem[];
  settings: SyncSetting[];
  cursor: { snapshot: number };
  /** まだ続きがあるか (件数の上限で切ったとき true)。 */
  more: boolean;
}

export interface SyncCursor {
  snapshot: number;
}

export interface SyncResult {
  pages: number;
  snapshots: number;
  items: number;
}
