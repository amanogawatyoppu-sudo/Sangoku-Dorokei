# 三国ドロケイ v7.3 (3D)

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

操作（PC）: W/S 前進・後退 / A/D 旋回 / Q 180°振り向き / Shift ダッシュ / Space 捕獲 / E 特殊 / ドラッグで上下の傾き・ホイールで距離

操作（スマホ）: 左下ジョイスティック（上下で前後、左右で旋回）、右下の 捕獲・特殊・ダッシュ・振向、画面の上下スワイプで傾き。
上部の「情報」でミニマップ・王候補、「ログ」で戦況ログを開閉。

カメラは常にキャラクターの背後にあり、背中側は見えません（背後を取るゲームなので）。確認したいときは Q で振り向きます。
階段・坂で2階・屋上・高台・見張り台へ上れます。足元の水色の弧が「正面」（この範囲の敵からは捕獲されない）、
緑〜橙のリングは今捕獲ボタンを押すと狙う相手です。

`npm run build` 後の `dist/index.html` は1ファイルで完結しており、ダブルクリックでそのまま遊べます。

`?debug` を付けて開くと、自動テスト用の読み取り専用フック `window.__sangoku` が有効になります。

## 構成

```
legacy/                 v6 の単一HTML（比較用・削除しない）
src/
  main.ts               組み立て（状態・描画・UI・入力をつなぐ）
  config/               国・役職・マップ（箱と坂でできた立体ワールド）・バランス定数
  core/                 clock（固定ステップ）/ loop（rAF）/ events（EventBus）/ rng
  sim/                  ゲーム状態とルール。DOM・Three.js・音声に触れない
    state.ts entity.ts events.ts step.ts game.ts
    systems/            world（高さ・衝突・見通し）movement collision vision capture jail rescue tower
                        randomEvents suspicion winCondition abilities
  ai/                   nav（経路網 + A*）/ perception（視野・見通し・足音）/ controller（追跡・捜索・護衛・救出）/ faction（三国の司令）
  meeting/              緊急会議のロジック
  input/                キーボード + Pointer Events → 軸 / コマンド
  render/               シーン構築（空・地形・城壁・楼閣など）・キャラ表示・カメラ・地面マーカー・生成テクスチャ
  ui/                   HUD・ログ・ミニマップ・各画面・ドロワー・イベント→文言
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
