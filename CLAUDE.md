# Tendentia — Claude Code ルール

LUDIARS 短縮コード: **Td**。トレンドの集積とトレンドマップの常駐サービス (Node + Hono + better-sqlite3)。
概要は [README.md](README.md)、仕様は `spec/feature/`、ドメインは `spec/domains/`。

## 作業

- 実装はローカル `main` 起点の task worktree で行い、Revisor local PR で提出する (GitHub PR・直 push はしない)。
- 起動・再起動は Excubitor 経由で本体 checkout からだけ行う。worktree から起動しない。
- 共通規約は `coding-conventions` skill。ドメイン (`src/trend/`) は他から状態を書き換えさせない。

## 構成の約束

- ポート番号は `excubitor.catalog.yaml` が正本。コードに既定値を持たない。
- 常駐は事前ビルド (`npm run build`) した `node dist/server.js`。tsx を常駐させない。
- AI は Claude Code CLI (`claude -p`) だけで呼ぶ。API キーを持たない。
- 個人データ (開いた記録・興味の設定) は `data/tendentia.db` に閉じる。
- 表を変えたら `scripts/site/data-bundle.mjs` の `SCHEMA_SQL` も合わせる (一致はテストで確かめる)。
- 新しいファイルは `spec/domains/*.domain.json` のどれかの `membership` に入れる (pathPattern は `(^|/)` で書く)。
