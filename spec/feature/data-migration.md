# データの導入と移行

## 目的

Castra の service-bootstrap 契約に従い、Excubitor が Tendentia を clone・セットアップ・データ移行できるようにする。
あわせて、2026-10-14 まで Memoria にあったトレンド機能のデータ (巡回の履歴・興味の設定・開いた記録・AI 要約) を
Tendentia へ 1 回だけ移す手段を持つ。

## 移行形式

`scripts/site/data-bundle.mjs` が正本。1 つの JSON ファイル。

```json
{ "service": "tendentia", "format": "tendentia-data", "version": 1, "persistentData": true,
  "exportedAt": "...", "data": { "settings": [], "snapshots": [], "items": [], "clicks": [] } }
```

- `settings`: `app_settings` のうち `trend_crawler.*` の行だけ (他の設定は運ばない)。
- `snapshots` は id を保ったまま運び、`items` は `snapshot_id` で参照する。存在しない取得を指す行は受け付けない。
- 余分な項目・他サービスの移行ファイル・版の違うものは受け付けない。上限 512 MB。
- 稼働中 DB の生ファイルは写さず、行を読み出して書く。

## 手順

Excubitor が呼ぶ (`excubitor.bootstrap.json`)。いずれも shell を介さず、対話入力なし。

- `scripts/site/setup.mjs`: `npm ci --include=dev` → 型チェック → ビルド → `data/` を用意。既存データは触らない。
- `scripts/site/export-data.mjs --output <絶対パス>`: 停止中の DB を移行ファイルに書く。出力が既にあれば失敗。
  DB がまだ無ければ空の各表を明示して書く。
- `scripts/site/import-data.mjs --input <絶対パス> --sha256 <64 桁>`: sha256・所有サービス・形式版・行の形を確かめ、
  1 トランザクションで書き込む。トレンドのデータが既にあれば断る。失敗したら書き込みは残らず、
  その import で新しく作った DB ファイルは消す。

Memoria からの移行 (1 回きり):

1. Tendentia を `start:false` で導入する (setup まで。起動すると巡回が始まり、import が「既にデータがある」で断る)。
2. `node scripts/migrate-from-memoria.mjs --memoria-db <Memoria の memoria.db> --output <絶対パス>` で移行ファイルを作る。
   Memoria の DB は読み取り専用で開き、トレンドの表と `trend_crawler.*` だけを読む。出力に sha256 が出る。
3. `import-data.mjs` (Excubitor の data-import) で取り込み、Tendentia を起動する。
4. Memoria 側のトレンド機能を外す。Memoria の DB に残った表は消さない (戻すときの元データ)。

## 制約

- 秘密・端末 ID は運ばない (このサービスは持たない)。
- 移行元のデータ削除は自動化しない。
