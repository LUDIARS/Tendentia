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
- `src/llm/claude-cli.ts`: AI 呼び出し。
- `scripts/build.mjs`: esbuild で `dist/server.js` と `dist/web/` を作る (依存パッケージは束ねない)。
- `web/`: 画面の外枠 (`index.html`・`style.css`・`src/main.ts`)。色は `:root` の変数で持ち、ダークモードで差し替える。

## 起動設定

| 変数 | 意味 | 既定 |
|---|---|---|
| `TENDENTIA_PORT` | 待受ポート。正本は `excubitor.catalog.yaml` (4450) | なし (必須) |
| `TENDENTIA_HOST` | 待受アドレス | `127.0.0.1` |
| `TENDENTIA_DATA_DIR` | DB の置き場所 (相対ならリポジトリ直下から) | `data` |
| `TENDENTIA_LLM_MODEL` | AI 要約のモデル (claude CLI のエイリアス) | `haiku` |
| `TENDENTIA_CLAUDE_BIN` | claude CLI の実行ファイル | `claude` |

常駐は `npm run build` 後の `node dist/server.js`。tsx は常駐させない。

## AI 呼び出し

`claude -p --model <model> --output-format text` を子プロセスで 1 回動かし、プロンプトを標準入力で渡す。
API キーは持たない (CLI のサブスクリプション認証)。`ANTHROPIC_API_KEY` などの API 課金系の変数と、
`CLAUDECODE` / `LICTOR_*` / `CONCORDIA_HOOK` などの親セッションへの紐付けにつながる変数は子へ渡さない。
1 回 8〜11 秒かかるので締切は 240 秒。起動できない・終了コードが 0 でないときはエラーで返す。

## 制約

- 待受は 127.0.0.1。API は同一端末判定 (接続元が同じ端末で、Host が自分の名前、Origin が一致) で守る。
- ポート番号はコードに既定値を持たない (catalog が正本)。
- 個人データ (開いた記録・興味の設定) は `data/tendentia.db` に閉じ、外へ送らない。AI へ送るのは公開ランキングの題名・補足・指標だけ。
