# トレンドクローラー

## 目的

いろいろなジャンルについて、公開されているランキング・人気一覧と、ジャンルごとのニュースサイト (アンテナサイト)
の RSS / API を定期巡回 (既定 3 時間ごと) して履歴に積み、Tendentia の画面 (トレンドマップ / リスト) に
ジャンル別で表示する。

前回の成功取得と比べた順位の動き (新登場 / ↑ / ↓ / →) と、保持期間内での初登場時刻、
別サイト同士で同じ話題が出ているもの (複数のソースで話題)、ジャンルごとの注目を出す。LLM は使わない。

1 ソースの取得失敗は他を止めない。失敗したソースは前回成功分の一覧を表示したまま、
最新巡回の失敗理由だけをカードに出す。

## 構成

- `src/trend/types.ts`: ジャンル・取得方式・ソース・設定・一覧表示・注目の型。
- `src/trend/default-sources.ts`: 既定ソース (API キー不要の公開 RSS / API のみ) を追加した版ごとに持つ。
- `src/trend/config.ts`: zod スキーマ、`app_settings` の `trend_crawler.config`。
- `src/trend/schema.ts`: 履歴テーブル `trend_snapshots` / `trend_items` / `trend_clicks` (src/runtime/db.ts から呼ぶ)。
- `src/trend/store.ts`: 履歴の記録・最新 2 回の成功取得・初登場時刻・保持期間外の削除 (SQL のみ)。
- `src/trend/movement.ts`: 比較キー正規化、順位の動き、複数サイト一致の判定 (純関数)。
- `src/trend/highlights.ts`: ジャンルごとの注目の選択 (純関数)。
- `src/trend/host-pacer.ts`: 同じサイトへの取得間隔と、サイトが続かない巡回順。
- `src/trend/overview.ts`: ソースごとの最新/前回比較をジャンル順に束ねた表示用一覧。
- `src/trend/service.ts`: 巡回手順 (取得 → 記録 → 古い履歴と開いた記録の削除)。
- `src/trend/coordinator.ts`: 手動巡回と定期巡回をプロセス内で 1 本に直列化。
- `src/trend/scheduler.ts`: 前回巡回から `intervalHours` 経過で巡回。例外時は 30 分空ける。
- `src/trend/router.ts`: 同一端末限定の HTTP API。
- `src/trend/sources/*.ts`: 取得方式ごとの解析 (純関数) と HTTP 取得の振り分け。
- `web/src/trend-crawler-view.ts`: ジャンルタブ、注目、ソース別カード、手動巡回、ソース設定 UI。
- `web/src/genres.ts`: 画面のジャンル名と色相。

## ジャンル

24 ジャンル。並び順が表示順。

| ジャンル | 主なソース |
|---|---|
| 総合 | Google トレンド (日本)、Wikipedia 日本語版の前日閲覧数、はてブ総合 |
| 若者 (Z世代) | Google ニュース検索 (Z世代 / TikTok / 女子高生 / 若者言葉 / Gen Z)、Reddit r/GenZ |
| ニュース・社会 | Yahoo!ニュース 主要、はてブ 世の中 / 政治と経済 |
| 株価・マーケット | Yahoo!ニュース 経済、Google ニュース検索 (株価 急騰 / 日経平均 / 米国株、直近 1 日) |
| IT | Yahoo!ニュース IT、ITmedia NEWS、はてブ テクノロジー、Zenn、Hacker News、Product Hunt |
| AI | ITmedia AI+、Google ニュース検索 (生成AI / 英語圏の AI model) |
| ガジェット | GIZMODO JAPAN、ITmedia Mobile、The Verge、Google ニュース検索 (ガジェット 新製品) |
| ゲーム | 4Gamer.net、AUTOMATON、Game*Spark、はてブ アニメとゲーム、Reddit r/gaming |
| アニメ | アニメ!アニメ!、AniList アニメ |
| マンガ | コミックナタリー、AniList マンガ |
| 小説 | 小説家になろう 日間 / 週間ランキング (公式 API)、Google ニュース検索 (ライトノベル) |
| 本 | Apple Books 有料 |
| 音楽 | 音楽ナタリー、BARKS、Real Sound 音楽、Apple Music トップソング・トップアルバム・トップミュージックビデオ |
| 芸能 | Yahoo!ニュース エンタメ、お笑いナタリー、Google ニュース検索 (芸能、直近 1 日) |
| エンタメ | 映画ナタリー、はてブ エンタメ / おもしろ、Apple Podcasts |
| ファッション | WWDJAPAN、ELLE Japan、Google ニュース検索 (ファッション トレンド) |
| 飲料 | 食品産業新聞 飲料、Google ニュース検索 (新商品 飲料) |
| レトルト・加工食品 | Google ニュース検索 (レトルト / 冷凍食品 / カップ麺 の新商品) |
| 食品 | 食品産業新聞、Google ニュース検索 (新商品 食品) |
| レストラン・外食 | ダイヤモンド・チェーンストアオンライン、Google ニュース検索 (飲食店 オープン / グルメ トレンド) |
| ネットミーム | ねとらぼ、Know Your Meme、Google ニュース検索 (ネットミーム) |
| アプリ | App Store 無料 / 有料、Google ニュース検索 (アプリ 話題) |
| 暮らし・知識 | はてブ 暮らし / 学び |
| 海外 | Google トレンド (米国)、Reddit r/popular、Wikipedia 英語版 |

公開ランキングの無いジャンル (株価・飲料・加工食品・外食など) は、ジャンル別のニュースサイトの RSS と
Google ニュースの検索結果 RSS から拾う。検索結果は関連度順なので、順位は話題の大きさではなく並び順として扱う。
株価は「値上がり銘柄」などの公式に公開された配信が見つからなかったため、ニュースで代える。
TikTok・Instagram・X の公式トレンドは API キーが要るため含めない。

## ソース種類

| kind | 取得方法 | 指標 |
|---|---|---|
| `rss` | RSS 1.0 (RDF) / 2.0 / Atom。並び順を順位とする | Google トレンド `ht:approx_traffic`、はてブ `hatena:bookmarkcount` |
| `apple_top` | `rss.marketingtools.apple.com` のランキング JSON。URL で国・種類・件数を指定 | なし |
| `wikipedia_top` | Wikimedia `pageviews/top` の前日 (UTC) 分。未公開 (404) なら 1 日遡る | 閲覧数 |
| `anilist_anime` / `anilist_manga` | `graphql.anilist.co` へ POST、`TRENDING_DESC`、`isAdult: false` | trending 値 |
| `hn_top` | Hacker News 公式 API `topstories` + 各 item | points / comments |
| `narou_ranking` | 小説家になろう公式 API (`api.syosetu.com/novelapi/api/`)。URL の `order` (dailypoint / weeklypoint / monthlypoint / hyoka) で並べる | 並び順に合ったポイント |

メインページ・特別ページ・名前空間付きの Wikipedia 記事は話題ではないので除く。
Google トレンドの item は link がフィード自身を指すため、最初の関連ニュースの URL を使う。

## 注目

ジャンルごとに最大 3 件、決まったルールで選ぶ (LLM は使わない)。

- 候補: 複数のサイトで話題 (cross)・新登場 (new)・前回から 3 位以上の上昇 (up)。
- 並べ方: 理由の重み (cross 3 / new 2 / up 1) の合計が大きい順 → 順位の高い順。
- 同じ話題が複数のソースに出ていたら 1 件にまとめ、重みが大きい方 (同じなら順位が高い方) を残す。

## 巡回の間隔

- 同じサイト (host) へは前回から 3 秒空けて取りに行く。Reddit は無認証の取得に厳しいので 15 秒。
- 巡回の順番は、サイトごとの列から 1 件ずつ取り出して並べ直し、同じサイトが続かないようにする
  (待ち時間を他のサイトの取得で埋める)。

## 既定ソースの追加

既定ソースは追加した版 (`DEFAULT_TREND_SOURCE_RELEASES`) ごとに持つ (版 1 = 初版、版 2 = 若者、版 3 = ジャンル拡充)。
保存済み設定の `defaultsVersion` より新しい版のソースだけを読み込み時に足す。
利用者が消した古い既定ソースは戻さず、同じ id があれば足さない。

## トレンドマップ

画面の既定表示。トレンド 1 つ 1 つを図形で並べ、色でジャンル、大きさと丸さで興味の度合いを表す。
興味が強いほど大きく丸く (0.75 以上は円)、弱いほど小さな横長の角丸矩形になる。最小の大きさがあり、消えはしない。

- 興味 = ジャンルの興味の強さ (0〜3、未設定は 1) × 気になる言葉の一致 × よく開くジャンル × 開いた話題 × トレンドの強さ。
  - よく開くジャンル: マップで開いた記録 (`trend_clicks`、直近 90 日) のジャンル比率。3 回未満は効かせない。
  - トレンドの強さ: ソース内順位、新登場、急上昇、複数サイト一致。
- スコアは対数で 0〜1 に正規化して大きさを決める。ジャンルの興味が 0 でもスコアは 0 にしない。
- 同じ話題が複数ソースに出ていても 1 枚にまとめる。1 ソースからは上位 8 件まで載せる。
- 色はジャンルごとの色相 (`web/src/genres.ts`) を inline の `--tm-h` で渡す。
- スマホ (幅 640px 以下) では円の代わりに、市場規模マップの形のジャンル別ブロックで見せる
  (2026-10-14 neco「円は見にくかった」「ブロックの中に注目ワードがいくつか並ぶ」)。興味は上位がどれも 0.7〜1 に
  固まるので、差をつけるために (2026-10-14 neco「大きさに差をつけて欲しい」) ブロックの広さはそのジャンルの全話題の
  興味の 2 乗の合計 (中央のジャンルの 35% を下限)、ブロックの中には興味の強い順に入るだけ (最大 6、ジャンルを絞ると 24) の
  話題を興味の 4 乗に比例した四角で並べ、入りきらない分は「ほか n 件」。割り付けは squarified treemap
  (`web/src/treemap-layout.ts`、ジャンル分けと高さは `treemap-blocks.ts`、描画は `trend-treemap-view.ts`)。
- 構成: `interest.ts` (純関数のスコア) / `interest-store.ts` (設定と開いた記録) / `map.ts` (タイル組み立て) /
  `web/src/trend-map-view.ts` (描画・ジャンル別の興味・気になる言葉)。
- 開いた記録は端末内の SQLite (`data/tendentia.db` の `trend_clicks`) に閉じる。ジャンルの興味 (`app_settings` の `trend_crawler.interest`) は
  マップの見え方そのものなので、AWS の viewer へ写す (下の「写し」)。

## 写し

2026-10-14 neco「Td は AWS に置きます」「巡回と収集は本社で」「閲覧だけでよい」。巡回は本社の collector
(`tendentia`、`TENDENTIA_ROLE=collector`) だけが行い、みんなが開く公開 URL は AWS の viewer
(`tendentia-viewer`、`TENDENTIA_ROLE=viewer`) が出す。viewer は巡回も変更もせず、本社から写しを取るだけ。

- collector: `GET /api/sync/export?after=<snapshot id>` で、その id より後の取得 (`trend_snapshots`) 最大 200 件と
  その項目 (`trend_items`)、写す設定 (`trend_crawler.config` / `trend_crawler.interest`) を返す。続きがあれば `more: true`。
  読み出しだけなので公開 URL (`tendentia-hq`) からも誰でも読める。データは全公開なので秘密の値は使わない。
- viewer: 起動 5 秒後と 10 分おきに、自分の持っている最大の id から続きが無くなるまで (最大 50 ページ) 取りに行く。
  取得は id を保ったまま入れ、既にある id は飛ばす (同じ書き出しを 2 回入れても増えない)。設定は丸ごと置き換え、
  値が null なら消す。取り込んだ位置は `app_settings` の `trend_replica.cursor` にも覚える (古い履歴を消しても同じ取得を取り直さない)。取り込み後、写した `retentionDays` で古い履歴を消す。失敗しても持っている分を出し続け、次の回で再試行する。
- viewer は同じ端末からも含めて書き込みを 403 にする (`この Tendentia は閲覧専用です`)。
- 開いた記録 (`trend_clicks`) は閲覧の行動そのものなので写さない。そのため viewer のマップには「よく開くジャンル」「開いた話題」が効かない。
- 構成: `src/trend/replica/` (`export.ts` 書き出し / `import.ts` 形の確認と取り込み / `puller.ts` 取りに行く / `router.ts` 書き出し口)。

## HTTP API (同一端末のみ)

- `GET /api/trend-crawler/config` / `PUT /api/trend-crawler/config`
- `GET /api/trend-crawler/overview` → `{ overview, busy }`
- `POST /api/trend-crawler/refresh[?source=<id>]` → `{ result, overview }`。巡回中は 409
- `GET /api/trend-crawler/map` → `{ map, busy }`
- `GET /api/trend-crawler/interest` / `PUT /api/trend-crawler/interest` (ジャンルの興味・気になる言葉)
- `POST /api/trend-crawler/click` (`{ key, genre, sourceId }`、マップで開いた記録)

2026-10-14 まで Memoria の AI タブにあった機能を独立させたもの。API のパスは Memoria のときと同じ。

## 制約

- 開いた記録は外へ送らない (写しにも入れない)。LLM は使わない (2026-10-14 neco「LLM は使用しなくてよい」で AI 要約を廃止)。
- 利用者が URL を変えられる GET 取得は `src/shared/public-fetch.ts` (SSRF ガード) を通す。
  AniList は固定の公式エンドポイントへの POST なので通常の fetch で 2MB / 20 秒まで。
- 比較キーは NFKC・小文字化・空白と記号の除去で作る。1 文字のキーは別話題の偶然一致が多いので
  複数サイト一致に使わない。同じサイトのカテゴリ違い (はてブ総合と暮らし等) の重複は数えない。
- 履歴は `retentionDays` (既定 30 日) より古い取得を巡回のたびに消す。
- ソースは 150 件まで。
