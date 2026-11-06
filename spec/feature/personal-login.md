# ログインと人ごとの好み

## 目的

誰でも公開 viewer を閲覧でき、ログインした本人だけが自分の興味と開いた記事を記録する。
Task: actio:5977c38f-5c8f-40c3-a35f-d1cf450c5eb6。
親の統合・一斉切替: actio:e0acdef1-32ef-40a8-bc38-be2250bed9cb。

## 決めたこと

- 個人データは viewer の `user_interest` / `user_clicks` に本人 id をキーとして保存する。
  Cr の user_data や collector への写しには含めない。集合的な個人傾向は公開しない。
- collector はログインを持たず、ローカル既定の興味・開いた記録を従来どおり扱う。
- viewer のサイト設定・巡回はログインしても変更できない。匿名閲覧は維持する。
- 独自の PASETO 検証、global token、refresh、旧 project-token 交換、長期署名 cookie を廃止する。

## SPEC-TD-SCOPED-SESSION

Cr `801756d1e354c486cbe0321acdc48909eed8afee` の backend Composite SDK を固定採用する。
取り込み内容・MIT・通信・依存審査は `vendor/cernere-composite/REVIEW.md`、ソース照合は
`source-pin.json`。SDK の暗号認証・project credential・オンライン operation guard を再利用する。
server への認証通信はユーザーの要求時だけで、SDK constructor に起動時通信はない。

## ログインの流れ

1. 画面がランダム verifier / state と S256 challenge を作る。popup はクリック直後に開き、
   同じ部品の busy を交換完了まで保持する。verifier はブラウザメモリだけに置く。
2. `POST /api/session/login/start {challenge,state}`。サーバは5分の pending attempt を作り、
   ランダム owner を HttpOnly cookie、nonce と clientId を JSON に返す。以前の session を先に失効する。
3. popup は Cr の `/composite/login?client_id=...&origin=...&code_challenge=...&state=...`。
   message は Cr の完全一致 Origin、実 popup の source、state、type、authCode の形を照合する。
4. `POST /api/session/login/complete {code,verifier,state,nonce}`。サーバは cookie owner と
   pending nonce/state/S256 を照合し、成功・不正いずれも一度限り消費する。交換の自動再試行はしない。
5. SDK が Td project credential で code + verifier を交換し、短命 grant をランダム opaque session の
   SHA-256 に一度だけ bind する。他 project・用途・verifier・期限・replay は Cr が拒否する。
   bind 後に pending 所有権を再確認し、終了していたら返された grant を revoke する。
6. `td_session` はランダム32バイトの opaque 値だけ。Secure / HttpOnly / host-only / SameSite=Strict / Path=/。
   server が process memory に grant と本人を持つ。cookie と server の期限は grant を超えず、延長しない。
   再起動は全 session を終了し、複数 process 間では共有しない。旧 `session.key` は読まない。
7. logout は pending と local owner を先に終了してから SDK revoke。通信失敗でも local owner は復活しない。
   rotation・並行 check・許可取得後の logout でも map の同一 entry と期限を DB 実行直前に確認する。
8. popup 閉鎖・timeout・abort・再描画・部品切断・pagehide は timer/listener/fetch/popup の所有権を終了する。
   正当な message 後の Cr 自身の popup 閉鎖は交換を中断しない。
   `POST /api/session/login/cancel {nonce}` は失われた完了応答との競合も含め試行を取り消す。
   終了済み試行の nonce は5分まで保持し、応答が失われた直後の cancel で local session も終了できる。
   cancel 自体が届かない場合の remote 状態は未確認であり、grant の固定期限を超えて保持しない。

## 入口の判定

session と viewer 個人 mutation は許可 Host・公開 Origin の完全一致と JSON Content-Type を要求する。
SameSite=Strict cookie と同一 Origin の JSON 要求（他 Origin の preflight を許可しない）で CSRF を拒否する。
viewer では loopback を cookie 操作の例外にしない。collector のローカル操作は従来の入口判定を使う。
個人 GET を含め SDK check で失効・不明・通信障害を拒否し、古い肯定結果を使わない。
無効 cookie 付き要求を匿名の書き込みへ落とさない。

| 経路 | action | risk |
|---|---|---|
| GET /api/session | tendentia.personal.session | sensitive_read |
| GET /api/trend-crawler/access | tendentia.personal.access | sensitive_read |
| GET /api/trend-crawler/map | tendentia.personal.map | sensitive_read |
| GET /api/trend-crawler/tendency | tendentia.personal.tendency | sensitive_read |
| GET /api/trend-crawler/interest | tendentia.personal.interest.read | sensitive_read |
| PUT /api/trend-crawler/interest | tendentia.personal.interest.write | important |
| POST /api/trend-crawler/click | tendentia.personal.click | important |

本人がいる場合だけ operation permit を authorize/consume する。resource は `self:<pathname>`、
requestId は SDK の新しい UUID、body は mutation の受信 JSON 文字列そのもの、GET は空文字。
risk/action は server 所有の method/path 対応表から決定する。対象 id を body/query から選ばず、
SDK consume 後に現在の本人・session entry・期限を確かめ、その本人 id で同期 DB 操作を実行する。
匿名公開閲覧は個人データを読まない。許可や DB の結果不明時に操作を自動再実行しない。

## 学習と傾向

マップは本人の興味・直近90日の開いた記録で構成する。未設定の興味はサイト既定を初期値とする。
傾向は本人のジャンル別回数、直近8週の推移、上位話題と興味設定を返す。計算式は既存のまま。
キャッシュも本人 id を区別し、オンライン許可と現在の所有権確認後だけ返す。

## 設定

| 変数 | 意味 |
|---|---|
| CERNERE_URL | Ex provides の backend Cr origin（HTTPS または loopback HTTP） |
| TENDENTIA_CERNERE_PUBLIC_URL | popup の canonical HTTPS Cr origin |
| TENDENTIA_SELF_URL | viewer の canonical HTTPS origin |
| CERNERE_PROJECT_CLIENT_ID / CERNERE_PROJECT_CLIENT_SECRET | Ex 標準 launch credential 注入 |

catalog は viewer だけ `cernere_launch_credentials.target_project: tendentia` を宣言する。
issuer credential の値は子に渡さない。部分設定は起動時エラーにし、秘密・全 config を出力しない。
collector は login config を読まない。

管理者が Cr の `hub_url` と `composite_origins` に viewer origin を登録し、上表の各 action を
`service_operations` に同じ risk と明示 consent permission（例 `service_operation.tendentia.personal`）で登録する。
Cr の現在の consent を必須にし、identity.basic だけで個人操作を許可しない。
設定変更・配備は本 PR では実行しない。全 consumer・target・管理者設定が揃うまで親が切替を保留する。

## 構成

`cernere-client.ts` は固定 SDK adapter、`pending-login.ts` は一度限りの試行、`user-session.ts` は
process 所有の opaque session、`personal-operation.ts` は経路分類、`login-router.ts` は session API。
`personal-store.ts` の既存の本人 id 別 DB 境界を保つ。`account-view.ts` が popup の lifecycle を所有する。

## 制約

個人データと grant はログ・写しへ出さない。grant をブラウザへ返さない。LLM は使わない。
ローカル Ex の collector/viewer が停止中である事実はサービス廃止を意味しない。
AWS 利用・配備は未確認。テスト実行・起動・統合・一斉切替はこの有限実装単位の完了証跡に含めない。
