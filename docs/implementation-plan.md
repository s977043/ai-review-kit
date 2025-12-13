# 実装計画（Milestone v0.1 / v0.2 / v0.3 / v1.0）

このドキュメントは、GitHub の Milestone（`v0.1.0—Public Ready` / `v0.2.0—Developer Experience` / `v0.3.0—Smart Reviewer` / `v1.0.0—Community Edition`）に **そのまま Issue を載せられる粒度（1〜2週間）**で、実装の一本道とバックログを固定します。

## 目的（勝ち筋）

- 「機能を増やす」より先に、**入力 → 判断 → 出力 → 通知**の流れを “細くても確実に通す”。
- v0.1 は「使って壊れない・説明できる・再現できる」。
- v0.2 は「使い始めの摩擦を減らす」。
- v0.3 は「River Reviewer っぽい賢さを 1 点突破」。

## Milestone ラベル運用（自動割当）

`.github/workflows/auto-milestone.yml` により、以下のラベルが付いた Issue は該当 Milestone に自動で割り当てられます。

- `m1-public` → `v0.1.0—Public Ready`
- `m2-dx` → `v0.2.0—Developer Experience`
- `m3-smart` → `v0.3.0—Smart Reviewer`
- `m4-community` → `v1.0.0—Community Edition`

前提:

- 上記 Milestone が GitHub 上に作成済みであること（タイトル一致が必要）。
- 上記ラベルが作成済みであること（未作成の場合は先に作る）。

## v0.1.0—Public Ready（DoD）

最小構成で「PR にレビューが返る」を確実にする。

- PR 差分を取り込める（merge-base が安定して取れる）
- Skill が 1 つでも動けばレビューコメントが出る（LLM なしでもフォールバック）
- 失敗時は「何が足りないか」と「次にやること」を返せる
- 同じ入力なら同じ出力になる（少なくとも非 LLM 経路）

## v0.2.0—Developer Experience（DoD）

導入・トラブルシュート・拡張の摩擦を下げる。

- 典型エラーが分類され、対処が明示される
- examples が段階的に学べる（最小 → 部分適用 → planner）
- “よくある失敗” が FAQ 化され、検索で辿れる

## v0.3.0—Smart Reviewer（DoD）

賢さを測って改善できるようにし、1 点突破を実用レベルまで持っていく。

- Planner の評価ケース（10〜20）が固定され、継続観測できる
- planner の ON/OFF がフラグ 1 つで切り替え可能（失敗時フォールバックが見える）
- “賢い” の方向を 1 つに絞り、評価で改善が確認できる

## 1〜2週間スプリント（推奨の一本道）

- Sprint 1（v0.1）: 入力→判断→出力→通知の最短 E2E を通す
- Sprint 2（v0.1）: “Hello Skill” 固定 + 回帰テスト + リリース締め
- Sprint 3（v0.2）: エラー/ログ/doctor（事前診断）で摩擦除去
- Sprint 4（v0.2）: examples 3 段階 + FAQ 5 本
- Sprint 5（v0.3）: Planner 評価セット拡充 + 記録/可視化
- Sprint 6（v0.3）: planner 切替戦略 + “賢さ 1 点突破” 着手
- Sprint 7-8（v1.0）: 互換性/安定 I/F + Community 運用の足場

---

## Backlog（Issue にコピペする用）

下記は `Issue Template: Task` にそのまま写せる形式です（タイトル + 推奨ラベル + 受け入れ条件）。

### v0.1.0（`m1-public`）

#### [Task] Action の外部リポ動作を保証する（E2E を壊さない）

- Labels: `type:task`, `P0`, `m1-public`
- 受け入れ条件:
  - 外部リポで `uses: s977043/river-reviewer/.github/actions/river-reviewer@v0.x` が動く
  - `target` が外部リポ（`github.workspace`）を指すときに差分取得できる
  - 失敗時に「次の行動」がログ/エラーで分かる（例: permissions, fetch-depth, token）
  - `npm test` が落ちない（回帰なし）

#### [Task] PR への通知（コメント投稿）を実装する（idempotent）

- Labels: `type:task`, `P0`, `m1-public`
- 受け入れ条件:
  - PR にレビュー結果がコメントとして投稿される
  - 再実行してもコメントが増殖せず、同一コメントが更新される（marker 運用）
  - 権限不足時に原因と対処が出る（`pull-requests: write` など）

#### [Task] “Hello Skill” を公式サンプルとして固定する（Quick Start 直結）

- Labels: `type:task`, `P1`, `m1-public`
- 受け入れ条件:
  - `skills/` に最小スキル 1 つが同梱される（依存なし、diff だけで動く）
  - README の Quick Start が “Hello Skill だけで成立” する
  - `npm run skills:validate` が通る

#### [Task] ゴールデンケース（差分→期待出力）を fixtures + tests に追加する

- Labels: `type:task`, `P1`, `m1-public`
- 受け入れ条件:
  - fixtures として “最小の差分” を追加し、回帰を検知できる
  - 非 LLM 経路で「同一入力→同一出力」がテストで担保される

#### [Task] v0.1 リリース締め（互換性/入力パラメータ/CHANGELOG）

- Labels: `type:task`, `P1`, `m1-public`
- 受け入れ条件:
  - `CHANGELOG.md` に互換性（breaking あり/なし）と注意点がある
  - Action inputs の “最低限セット” が README に固定される
  - `npm run lint` と `npm test` が Green

### v0.2.0（`m2-dx`）

#### [Task] ユーザー向けエラー/ログ設計を揃える（分類 + 対処）

- Labels: `type:task`, `P0`, `m2-dx`
- 受け入れ条件:
  - 典型エラーが分類される（設定不足/スキル不正/API/権限/差分取得）
  - メッセージに「次にやること」が必ず含まれる
  - 代表 3 ケースで回帰テストまたは fixtures がある

#### [Task] examples を 3 段階にする（最小/部分適用/planner）

- Labels: `type:task`, `P1`, `m2-dx`
- 受け入れ条件:
  - example-1: Hello Skill（最小）
  - example-2: upstream|midstream|downstream のどれか 1 つのみ
  - example-3: planner あり（切替フラグ付き）

#### [Task] “Add new skill” を最短手順で整備する（ガイド）

- Labels: `type:task`, `P1`, `m2-dx`
- 受け入れ条件:
  - スキル作成→検証→実行までの最短パスが 1 本にまとまっている
  - スキーマと例がリンクされ、迷子にならない

#### [Task] FAQ（よくある失敗）を 5 本固定する

- Labels: `type:task`, `P1`, `m2-dx`
- 受け入れ条件:
  - “起きがちで致命” を優先して 5 本
  - それぞれに「症状/原因/対処/確認コマンド」がある

### v0.3.0（`m3-smart`）

#### [Task] Planner 評価セットを 10〜20 ケースに拡充し、記録できるようにする

- Labels: `type:task`, `P0`, `m3-smart`
- 受け入れ条件:
  - ケース（diff/skills/context/expected）が固定される
  - `npm run planner:eval` の指標が継続観測できる（top1/coverage/MRR 等）

#### [Task] planner の切り替え戦略を実装する（なし=全適用、あり=絞り込み）

- Labels: `type:task`, `P1`, `m3-smart`
- 受け入れ条件:
  - planner 無し: 決定論で全スキル（または既存の選別）を実行
  - planner 有り: 優先度づけ/絞り込み
  - フラグ 1 つで切替でき、失敗時はフォールバック理由が出る

#### [Task] “賢い” を 1 つだけ強くする（方向決定 + 着手）

- Labels: `type:task`, `P1`, `m3-smart`
- 受け入れ条件:
  - 方向が 1 つに決まっている（例: 影響範囲推定 / テスト不足 / ADR 整合）
  - 評価ケースで “外してない” 判定が置ける（完全一致は不要）

### v1.0.0（`m4-community`）

#### [Task] 互換性ポリシーと安定 I/F を固定する（v1.0 準備）

- Labels: `type:task`, `P0`, `m4-community`
- 受け入れ条件:
  - breaking change の扱い（スキーマ/CLI/Action）を明文化
  - Action/CLI の入力・出力・終了コードがリファレンス化される

#### [Task] Community 運用の最小セットを整える（CONTRIBUTING/ラベル/テンプレ）

- Labels: `type:task`, `P1`, `m4-community`
- 受け入れ条件:
  - Issue/PR の導線が 1 本にまとまる
  - ラベル/マイルストーン運用が再現できる
