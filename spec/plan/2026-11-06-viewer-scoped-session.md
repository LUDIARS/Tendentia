# viewer の Composite scoped session

Task: actio:5977c38f-5c8f-40c3-a35f-d1cf450c5eb6
Parent: actio:e0acdef1-32ef-40a8-bc38-be2250bed9cb

実装単位は仕様・回帰契約の保存、静的型確認、commit、Revisor local PR 受付まで。
テスト・サービス起動・配備・マージは実行しない。親が後段の審査と一斉切替を引き取る。

Cr SDK は 801756d1e354c486cbe0321acdc48909eed8afee に固定する。
暗号認証・オンライン許可を再実装せず SDK を再利用する。旧 global token、refresh、
project-token 交換、長期署名 cookie の互換は持たない。

## 受け入れ契約

C-1 CernereClient.login(code, verifier, opaque): project-bound exchange を一度だけ行い期限内の Td grant を bind する
C-2 SessionSigner.read(cookie): opaque cookie の現行所有者だけを返し失効後は復活しない

## 検証計画

- project/verifier/state/nonce の不一致、replay、expired/revoked/unknown authority を拒否する。
- pending login の一度限り消費、並行 bind、logout 中の応答、期限延長を拒否する。
- SDK operation の action/resource/raw body digest/risk と DB 実行直前の本人所有権を合わせる。
- collector の匿名ローカル操作と公開閲覧を維持し、viewer 個人データは本人に限定する。
- popup の origin/source/state、重複クリック、abort、破棄時の cleanup を確認する。
- テスト実行は Revisor に委託。型・静的検査のみこのセッションで実行する。

Augur security plan の test-001（対象操作の認可）、test-002（入力境界）、test-003（replay/abuse）に対応し、
login.test.ts / session-lifecycle.test.ts / web/test/account-view.test.ts を保存した。
一般提案の log-only rollback は fail-closed 要件に反するので採用しない。
SDK auth 基盤と既存 personal-store の本人 id 別 query を再利用し、UI SDK の React/WebAuthn は不要なので採用しない。

## 静的確認と提出範囲

サーバ（テストを含む）・画面の tsc noEmit、Augur contracts lint/runtime check と inject check を実施する。
SDK は保存した固定ソースから declaration/JS を生成するだけで、install/publish hook や SDK 実行は行わない。
依存 manifest/lock は変更しない。型確認用 node_modules は既存 main checkout の実体を参照する。
回帰テストは保存のみで実行していない。Augur C-1/C-2 の runtime metrics は未観測であり met としない。
Revisor の登録済み npm test へ渡す。統合後の本人操作・ブラウザ・設定反映・配備は親の担当範囲。
