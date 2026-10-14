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
- `src/runtime/access-gate.ts`: 入口の判定 (同じ端末 / 公開 URL + Cloudflare Access / それ以外は拒否)。
- `src/runtime/cf-access.ts` / `cf-jwt.ts`: Cloudflare Access の JWT 検証 (依存なし、Elegantia の実装が土台)。
- `src/runtime/local-request.ts`: API を同じ端末からのリクエストだけに絞る判定 (Memoria から移した)。
- `src/shared/public-*.ts`: SSRF ガード付きの公開 URL 取得 (Memoria から移した)。
- `scripts/build.mjs`: esbuild で `dist/server.js` と `dist/web/` を作る (依存パッケージは束ねない)。
- `web/`: 画面の外枠 (`index.html`・`style.css`・`src/main.ts`)。色は `:root` の変数で持ち、ダークモードで差し替える。

## 起動設定

| 変数 | 意味 | 既定 |
|---|---|---|
| `TENDENTIA_PORT` | 待受ポート。正本は `excubitor.catalog.yaml` (4450) | なし (必須) |
| `TENDENTIA_HOST` | 待受アドレス | `127.0.0.1` |
| `TENDENTIA_PUBLIC_URL` | 公開 URL (https の Origin)。catalog が `https://tendentia${DOMAIN_ROOT}` を渡す | なし (公開しない) |
| `LUDIARS_ALLOWED_HOSTS` | 公開として受け付ける追加の Host (Excubitor の global env) | なし |
| `TENDENTIA_CF_ACCESS_TEAM_DOMAIN` / `TENDENTIA_CF_ACCESS_AUD` | Access の設定を明示するとき (2 つ組)。無ければ `EXCUBITOR_SERVICE_CONFIG_JSON` の `cloudflareAccess` | なし |
| `TENDENTIA_DATA_DIR` | DB の置き場所 (相対ならリポジトリ直下から) | `data` |

常駐は `npm run build` 後の `node dist/server.js`。tsx は常駐させない。

## 公開の入口

外 (スマホなど) からは Cloudflare Tunnel 経由の公開 URL で開く。2026-10-14 neco「秘匿物ないので全公開で良い」により、
既定は Cloudflare Access なしの全公開で、公開 URL からは閲覧だけできる。判定の順 (health は誰でも見られる):

1. 同じ端末 (接続元が自分、Host が自分の名前・アドレス、Origin が一致) → 通す。変更もできる。
2. Host が公開 URL / `LUDIARS_ALLOWED_HOSTS` に一致 →
   - Access の設定 (team / AUD) が無い (全公開): 閲覧 (GET / HEAD) だけ通す。書き込み (設定・巡回・興味・開いた記録) は 403。
   - Access の設定がある: `Cf-Access-Jwt-Assertion` を Access チームの公開鍵 (RS256) で検証し、iss・aud・exp・nbf を確かめる。
     正しければ変更もできる (書き込みで Origin が付いていれば公開 URL と一致を求める)。だめなら 403。
3. それ以外 → 403。

画面は `GET /api/trend-crawler/access` (`{ canEdit }`) を見て、変更できないときは操作の部品 (`td-edit`) を隠し、
開いた記録も送らない。Access を付けるときは `cf:access-app` (Castra command-runner) が team / AUD を Excubitor の
runtime-config に書き、Excubitor が `EXCUBITOR_SERVICE_CONFIG_JSON` で渡す。

## 制約

- 待受は 127.0.0.1。API は同一端末判定 (接続元が同じ端末で、Host が自分の名前、Origin が一致) で守る。
- ポート番号はコードに既定値を持たない (catalog が正本)。
- 個人データ (開いた記録・興味の設定) は `data/tendentia.db` に閉じ、外へ送らない。
- LLM は使わない (2026-10-14 に AI 要約と Claude Code CLI の呼び出しを廃止)。
