# Cr SDK 固定ソースの採用審査

採用: Cernere `801756d1e354c486cbe0321acdc48909eed8afee` の backend SDK。
初回採用なので全 backend source を読んだ。直近7日（2026-10-30〜2026-11-06）の
SDK 変更は b2bc69c（project PKCE・session・operation）と 801756d（upload reservation）。
本差分は前者の exchange / bind / check / revoke / run を利用する。

MIT。source/LICENSE を保持する。TS compiler で生成した dist の JS と宣言も保存し、
既存の strip-types/erasableSyntaxOnly 設定と SDK の parameter property を分離する。
source-pin.json は git blob の SHA-256。SDK の install/build/publish hook は実行しない。
backend import graph は node:crypto と SDK 内の相対 import のみ。
React UI と @simplewebauthn/browser は取り込まず、依存・通信を増やさない。

実行される committed `dist` は `scripts/vendor-composite.test.mjs` が固定 source から一時領域へ
再生成し、全 JS・宣言ファイルの名前と bytes を照合する。source と dist の片側だけを変更した
場合は登録済み `npm test` が失敗する。

通信は設定された Cr origin への project credential 認証・code/verifier 交換・service
authority POST のみ。TLS または loopback HTTP、redirect error、timeout、dispose abort。
secret は project 認証 body、project credential は Authorization、grant は authority body。
テレメトリ、外部 DNS 指定、process 実行、環境変数読み取り、native code は SDK に無い。
upload/delegation の実装は SDK import graph として保持するが Td の経路には公開しない。
確認された不要通信なし。複雑な認証を小規模自作へ置換しない。

ローカル既存依存の型検査には main checkout の node_modules を参照する。
実行テストの成功や配備の検証を意味しない。再生成時は固定 source と compiler を照合する。
