# ログインと人ごとの好み

## 目的

2026-10-14 neco「Cr ログインしてユーザーによる偏向学習と嗜好の傾向を取得する」「見るのは誰でも、ログインした人だけ学習」。
AWS の viewer (`tendentia.ai-run-do.com`) は今まで通り誰でも見られる。Cernere でログインした人だけ、その人が開いた記事と
興味の設定からその人向けにマップの大きさを変え (偏向学習)、その人の好みの傾向を見られるようにする。

## 決めたこと

- ログインしない人の画面・API は変えない (全公開・閲覧だけ)。
- 人ごとの記録は viewer 自身の DB (`user_interest` / `user_clicks`) に Cernere の `sub` (ユーザー id) で持つ。
  Cernere の user_data には何も書かない。本社 (collector) には写さず、写しの書き出しにも入れない。
- viewer の「閲覧専用」は「サイトの設定・巡回は誰も変えられない。ログインした本人の好みの記録だけ書ける」に変える。
- 本社 (collector) はログインを持たない (Cernere の composite は `tendentia` の公開 Origin だけを許可する)。
- 集計 (みんなの傾向) は作らない。傾向はログインした本人の分だけを本人に見せる。

## ログインの流れ

Aedilis と同じ形 (Cernere `docs/composite_design.md`)。

1. 画面: `POST /api/session/login/start` → `{ nonce }` (nonce は httpOnly / SameSite=Strict の cookie にも入れる、5 分)。
2. 画面: popup で `<Cernere 公開 URL>/composite/login?origin=<自分の Origin>` を開き、postMessage
   `{ type: "cernere:auth", authCode }` を受け取る (送信元 Origin と popup を確かめる)。
3. 画面: `POST /api/session/login/complete { code, nonce }`。サーバは nonce を cookie と照合し、
   `POST <CERNERE_URL>/api/auth/exchange` で code をユーザー token に、
   `POST <CERNERE_URL>/api/auth/project-token { project_key: "tendentia", hub_url: <自分の公開 URL> }` で
   Tendentia 向けの PASETO v4.public token に替える。
4. サーバは token を Cernere の公開鍵 (`GET <CERNERE_URL>/.well-known/cernere-public-key`) で検証する
   (署名・`aud` = 自分の公開 URL・`exp`・`kind = user_for_project`・`projectKey = tendentia`)。
5. 通ったら Tendentia 自身のログイン cookie (`td_session`) を出す。中身は `sub`・表示名・期限 (30 日) で、
   data dir の `session.key` (初回起動時に乱数で作る、0600) で HMAC-SHA256 署名する。httpOnly / Secure / SameSite=Lax。
6. `POST /api/session/logout` で cookie を消す。`GET /api/session` → `{ loginAvailable, cernereUrl, user }`。

Cernere の project token は 15 分で切れるので、そのまま cookie にはしない (15 分ごとの再ログインを避ける)。
Tendentia のログイン cookie は好みの記録にだけ効く。Cernere 側でログアウトしても、この cookie は期限まで残る。

## 入口の判定

`AccessGate.decide(context, scope)`。ログイン cookie があれば、どの判定にも `userId` を付ける。

| scope | 書き込みを通す条件 |
|---|---|
| `site` (設定・巡回) | 従来どおり (同じ端末から。viewer は誰も不可) |
| `personal` (興味の設定・開いた記録) | 同じ端末から (viewer を除く)、またはログイン済みで書き込みの Origin が公開 URL と一致 |
| `session` (ログイン・ログアウト) | 書き込みの Origin が公開 URL と一致 |

## 学習と傾向

- ログインした人のマップ: 興味の設定はその人のもの (未設定なら本社の既定を写した値)、
  開いた記録 (`user_clicks`、直近 90 日) もその人のものだけで大きさを決める。式は `trend-crawler.md#トレンドマップ` と同じ。
- `GET /api/trend-crawler/tendency` (ログイン必須): 直近 90 日の
  - ジャンルごとの開いた回数と割合 (多い順)
  - 週ごとの開いた回数 (直近 8 週、多いジャンル 5 つ)
  - よく開いた話題 (タイトル、上位 10)
  - いまの興味の設定 (ジャンルごとの強さ・気になる言葉)
- 開いた記録には話題のタイトルも持つ (傾向に出すため)。90 日より古い記録は消す。

## 設定

| 変数 | 意味 |
|---|---|
| `CERNERE_URL` | サーバから Cernere を呼ぶ URL (Excubitor の Cernere provides から届く) |
| `TENDENTIA_CERNERE_PUBLIC_URL` | 画面が popup で開く Cernere の公開 URL (https)。viewer の catalog が `https://cr${DOMAIN_ROOT}` を渡す |

両方と `TENDENTIA_SELF_URL` があるときだけログインを出す。無ければ `loginAvailable: false` で今まで通り動く。

## 構成

- `src/runtime/paseto-v4.ts`: PASETO v4.public の検証 (依存なし、Node の Ed25519)。
- `src/runtime/cernere-client.ts`: exchange / project-token / 公開鍵の取得。
- `src/runtime/user-session.ts`: ログイン cookie の発行と読み取り (HMAC)。
- `src/runtime/login-router.ts`: `/api/session/*`。
- `src/trend/personal-store.ts`: `user_interest` / `user_clicks` の読み書きと傾向の集計。
- `web/src/account-view.ts`: ログイン・ログアウトの部品。`web/src/tendency-view.ts`: 「あなたの傾向」。

## 制約

- ログイン cookie の署名鍵 (`session.key`) と人ごとの記録は data dir の外へ出さない (写しにもログにも出さない)。
- 開いた記録・興味は本人以外に見せない。傾向 API は本人の分だけを返す。
- LLM は使わない。
