# Tendentia (Td)

いろいろなジャンルの「いま流行っているもの」を定期的に集めて、興味の度合いで大きさが変わるマップで見せるサービス。
ラテン語の *tendentia* (傾向) から。2026-10-14 に Memoria の AI タブ「📈 トレンド」から独立した。

- 検索・若者 (Z世代)・ニュース・テック・ゲーム・アニメ/マンガ・音楽・アプリ・本・エンタメ・暮らし・海外の 12 ジャンル、
  API キー不要の公開ランキング 31 ソースを 3 時間ごとに巡回する。
- 前回からの順位の動き (NEW / ↑ / ↓)、複数のサイトで話題のもの、AI (Claude Code CLI) のジャンル別要約。
- トレンドマップ: 色 = ジャンル、大きさと丸さ = 興味の度合い (ジャンルの興味・気になる言葉・よく開くジャンル)。
  興味が薄いものも小さく残る。

## 動かし方

起動・停止は Excubitor 経由で、本体 checkout (`E:/Document/Ars/Tendentia`) からだけ行う。
ポートは `excubitor.catalog.yaml` (4450)。画面は `http://127.0.0.1:4450/` (同じ端末からだけ開ける)。

```sh
npm ci --include=dev
npm run typecheck
npm test
npm run build      # dist/server.js と dist/web/
```

## 仕様

- [トレンドクローラーとトレンドマップ](spec/feature/trend-crawler.md)
- [サービスの土台](spec/feature/service-runtime.md)
- [データの導入と移行](spec/feature/data-migration.md)
