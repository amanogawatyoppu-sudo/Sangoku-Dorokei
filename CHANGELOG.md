# Changelog

## v7.0 — 基盤移行（完了）

- v6 の単一 HTML を Vite + TypeScript + Three.js (npm) + Vitest 構成へ移植（`legacy/` に v6 原本を保存）
- sim / ai / meeting / input / render / ui / audio に責務分離。sim はイベント発行のみで DOM・three・音声に非依存
- ゲーム時間を `state.time`（60Hz 固定ステップ）に統一。会議中・終了後・タブ非表示中は全タイマー停止
- 修正: A/D 左右反転、古い会議タイマーが次の会議を閉じる問題
- テスト 58 件
