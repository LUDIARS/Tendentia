# サービスの土台

## 目的

Tendentia を Memoria から独立した常駐サービスとして動かす。起動・停止は Excubitor が行い、
Tendentia は設定の読み込み・データの用意・HTTP の入口・定期巡回の開始だけを持つ。

## 構成

- `src/main.ts`: 起動。設定を読み、DB を開き、HTTP と定期巡回 (`src/trend/scheduler.ts`) を始める。
- `src/runtime/config.ts`: 環境変数からの起動設定。
- `src/runtime/db.ts`: `data/tendentia.db` を開き、`app_settings` とトレンドの表を用意する (WAL)。
- `src/runtime/app.ts`: Hono アプリ。`GET /health`、`/api/trend-crawler/*`、画面の配信。
- `src/runtime/static.ts`: `dist/web` の決まったファイル (index.html / app.js / style.css) だけを返す。
- `src/runtime/local-request.ts`: API を同じ端末からのリクエストだけに絞る判定 (Memoria から移した)。
- `src/shared/public-*.ts`: SSRF ガード付きの公開 URL 取得 (Memoria から移した)。
- `scripts/build.mjs`: esbuild で `dist/server.js` と `dist/web/` を作る (依存パッケージは束ねない)。
- `web/`: 画面の外枠 (`index.html`・`style.css`・`src/main.ts`)。色は `:root` の変数で持ち、ダークモードで差し替える。

## 起動設定

| 変数 | 意味 | 既定 |
|---|---|---|
| `TENDENTIA_PORT` | 待受ポート。正本は `excubitor.catalog.yaml` (4450) | なし (必須) |
| `TENDENTIA_HOST` | 待受アドレス | `127.0.0.1` |
| `TENDENTIA_DATA_DIR` | DB の置き場所 (相対ならリポジトリ直下から) | `data` |

常駐は `npm run build` 後の `node dist/server.js`。tsx は常駐させない。

## 制約

- 待受は 127.0.0.1。API は同一端末判定 (接続元が同じ端末で、Host が自分の名前、Origin が一致) で守る。
- ポート番号はコードに既定値を持たない (catalog が正本)。
- 個人データ (開いた記録・興味の設定) は `data/tendentia.db` に閉じ、外へ送らない。
- LLM は使わない (2026-10-14 に AI 要約と Claude Code CLI の呼び出しを廃止)。
