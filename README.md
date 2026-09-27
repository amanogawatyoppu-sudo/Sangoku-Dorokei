# 三国ドロケイ v7.0 (3D)

太陽・月・星の三国で敵国の王を探し出して捕らえる、ブラウザ向けの3Dドロケイゲームです。
v7.0 はゲーム内容を v6 のまま、Vite + TypeScript + Three.js (npm) + Vitest の構成へ移しました。

## 起動

```bash
npm install
npm run dev      # http://localhost:5173/
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 型チェック + 本番ビルド (`dist/`) |
| `npm run preview` | ビルド結果の確認 |
| `npm run test` | Vitest |

操作: 移動 WASD / 視点 ドラッグ・スワイプ / ダッシュ Shift / 捕獲 Space / 特殊 E

## 構成

```
legacy/                 v6 の単一HTML（比較用・削除しない）
src/
  main.ts               組み立て（状態・描画・UI・入力をつなぐ）
  config/               国・役職・マップ・バランス定数
  core/                 clock（固定ステップ）/ loop（rAF）/ events（EventBus）/ rng
  sim/                  ゲーム状態とルール。DOM・Three.js・音声に触れない
    state.ts entity.ts events.ts step.ts game.ts
    systems/            movement collision vision capture jail rescue tower
                        randomEvents suspicion winCondition abilities
  ai/controller.ts      v6 の AI（挙動はそのまま）
  meeting/              緊急会議のロジック
  input/                キーボード・マウス・タッチ → 軸 / コマンド
  render/               シーン構築・キャラ表示・カメラ
  ui/                   HUD・ログ・ミニマップ・各画面・イベント→文言
  audio/sfx.ts          効果音
tests/                  Vitest
```

### 設計ルール

- **ゲーム時間は `state.time` だけ。** 60Hz の固定ステップ (`stepSimulation`) でのみ進むため、
  会議中・ゲーム終了後・タブ非表示中は牢屋・スタン・偽装・レーダー・イベント・クールダウンが全て止まる。
- **sim は出来事を `GameEvent` として `state.events` に積むだけ。**
  UI・音声がそれを受けてログ・バナー・効果音を出す（`ui/messages.ts`, `audio/sfx.ts`）。
- 描画は状態を毎フレーム読み取り、ステップ間を補間して表示する。
- `tests/architecture.test.ts` が sim/ai/meeting/core/config から three・DOM・音声・実時間タイマーを使っていないことを検査する。
