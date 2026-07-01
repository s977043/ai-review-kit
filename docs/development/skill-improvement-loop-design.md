# Skill 改善ループ設計（使用 → 最適化の自動化）

> Status: Draft
> Related: `skills/agent-skills/river-review/references/IMPROVEMENT_LOOP.md`、`docs/development/skill-pack-design.md`、`docs/development/skill-eval-kpi.md`、`docs/development/improvement-flow.md`

## 1. 背景と目的

skill が「ただ作られている」状態から、「**使われることで最適化・強化・改善される**」状態へ移行するための設計です。

現状調査（2026-06-10）の結論は次の通りです。

- レビュー実行 → finding 検証 → feedback 分類（7 型 taxonomy）→ 対応先マッピング（FEEDBACK_TO_FIXTURE.md の変換表）までは **実装済み**
- suppression（P1 ガード込み）、eval ledger、per-skill FP rate 計算、skill-optimizer（手動診断ツール）も **実装済み**
- 欠けているのは「feedback から skill 改善へ戻る **自動化のリンク**」であり、現状この区間はすべて人間の手動運用に依存している

つまり設計図と部品は揃っており、本ドキュメントは欠落リンクを特定して接続する計画を定義します。

## 2. 改善ループの全体像

```text
[使用]                    [記録]                    [改善]
review 実行 ──finding──▶ feedback 分類（7型） ──▶ 対応先へ自動変換 ──▶ skill 強化
   ▲                        │                        │                  │
   │                        ▼                        ▼                  ▼
   │                  .river/feedback/         fixture / suppression   SKILL.md 修正
   │                  （構造化 JSONL）          / reference / routing    tier 昇格・降格
   │                                                 │
   └────────────── eval（回帰検知）◀───────────────────┘
```

ループの成立条件は「**各矢印が機械可読・機械実行可能であること**」です。人間が挟まるのは判断（merge / official 昇格）のみとし、転記・変換・検知は自動化します。

## 3. 欠落リンクと実装計画

| #   | Missing link                     | 内容                                                                                                                                          | 優先度 |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| L1  | feedback の構造化キャプチャ      | `river feedback add` CLI と `.river/feedback/*.jsonl`。PR コメント・self-review・eval 失敗を共通スキーマで記録する                            | P0     |
| L2  | feedback → 対応先の自動変換      | `npm run feedback:apply`。FEEDBACK_TO_FIXTURE.md の変換表を実行可能にする（fixture 雛形 / suppression エントリ / reference 更新案の自動生成） | P0     |
| L3  | eval 回帰 → 改善フローの自動起票 | `eval:compare` の劣化検知時に、対象 skill と差分を添えた Issue を自動生成する                                                                 | P0     |
| L4  | suppression パターン分析         | 同一 fingerprint が N 回（目安 3 PR）以上 suppress されたら「skill 改善が必要」と判定し、skill-optimizer 診断の起票につなげる                 | P1     |
| L5  | per-skill FP rate の時系列追跡   | ledger に skill 別 FP rate を追記し、悪化トレンド（例: 2 snapshot 連続で +3pt）でアラートする                                                 | P1     |
| L6  | rule 昇格の機械検出              | 同種 feedback が 2 回以上発生したクラスを検出し、ルール化候補として提示する（IMPROVEMENT_LOOP Step 9 の自動化）                               | P2     |
| L7  | 修正PR → feedback 取り込み       | 修正PR / follow-up PR を `fix-pr` trigger として記録し、元PRレビューの `missed_issue` を fixture / routing / reference 改善へ戻す             | P2     |

### L1: feedback キャプチャのスキーマ案

```jsonl
{
  "timestamp": "2026-06-10T03:00:00Z",
  "trigger": "pr-comment",
  "feedbackType": "false_positive",
  "skillId": "typescript-strict",
  "findingFingerprint": "a1b2c3d4e5f60718",
  "evidence": "strict 設定済みの tsconfig を誤検出",
  "pr": 1100
}
```

- 置き場所は `.river/feedback/<YYYY-MM>.jsonl`（suppression / runs と同じ `.river/` 配下の規約に従う）
- `feedbackType` は既存 taxonomy（accepted / false_positive / missed_issue / not_actionable / duplicate / accepted_risk / unclear）をそのまま使う
- `trigger` は IMPROVEMENT_LOOP.md の起動条件（pr-comment / self-review / eval-regression / retrospective / fix-pr）に対応させる

### L2: 自動変換の責務境界

自動化するのは「**雛形の生成まで**」であり、適用の最終判断は人間が PR レビューで行います。

| feedbackType             | 自動生成物                                             | 検証コマンド                                                                           |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| false_positive           | guard fixture（should-not-detect）の雛形               | `npm run eval:fixtures` + `npm run eval:repo-context`                                  |
| missed_issue             | happy-path fixture（should-detect）の雛形              | `npm run eval:fixtures` + `npm run eval:repo-context` + `npm run planner:eval:dataset` |
| accepted_risk            | `river suppression add` コマンド一式（rationale 必須） | `npm run skills:validate`（加えて `npm run eval:regression` で抑制の回帰を確認）       |
| not_actionable / unclear | SKILL.md の出力・文言修正の提案コメント                | `npm run skills:validate` + 手動レビュー                                               |
| duplicate                | routing 修正の提案コメント                             | `npm run planner:eval:dataset` + `npm run skills:validate`                             |

変換の対応関係と検証コマンドの SSoT は `skills/agent-skills/river-review/references/FEEDBACK_TO_FIXTURE.md` であり、上表は概要です。差異が生じた場合は SSoT 側を正とします。

### L4: suppression 分析と skill-optimizer の接続

skill-optimizer（手動診断ツール）は既に存在するため、新規に作るのは **起動条件の検知** だけです。
週次バッチで suppression index をスキャンし、閾値超過の skill について「診断推奨」を Issue 化します。Issue へ skill id・suppress 回数・severity 履歴を添付し、skill-optimizer の入力としてそのまま使える形にします。

なお現行の `scripts/skills-audit.mjs` は skill メタデータの検証が責務であり、suppression スキャンは含まれません。
L-3 では skills-audit の拡張ではなく、suppression 分析専用のスクリプト（例: `scripts/suppression-analytics.mjs`）を新設する想定です。

### L7: 修正PRからの skill 改善入力

修正PR / follow-up PR は、レビュー結果に対する明示コメントが無い場合でも「元PRレビューで捕まえられなかった事象」の強い信号になります。
ただし、修正PRの diff を直接 SKILL.md に追記すると、個別事象に寄った rule が増えるため危険です。River Review では、修正PRをまず `fix-pr` trigger の feedback として記録し、既存の L1 / L2 / L6 に流します。

運用手順:

1. 修正PRの title / body / diff / linked issue から、元PRと失敗内容を確認する。
2. 失敗内容を `missed_issue` / `not_actionable` / `duplicate` など既存 taxonomy に分類する。
3. owner skill を推定する。推定できない場合は routing miss として planner / routing 側の改善候補にする。
4. `river feedback add --trigger fix-pr` で `.river/feedback/*.jsonl` に記録する。
5. `npm run feedback:apply` で fixture / reference / routing の scaffold を生成する。
6. `npm run feedback:rules` で同種の見落としが 2 回以上発生していないか確認する。
7. 反映は必ず PR レビューを通す。自動で SKILL.md / reference / fixture を更新しない。

記録例:

```bash
npm run river -- feedback add \
  --type missed_issue \
  --skill typescript-strict \
  --trigger fix-pr \
  --pr 1234 \
  --evidence "Fix PR #1234 showed original PR #1200 missed a nullable response edge case."
```

この設計は、Claude Code Skills のような agent skill 運用で有効な「レビュー漏れの修正PRを食べて改善する」考え方を、River Review の repo-owned / versioned / HITL 前提に合わせて落とし込むものです。

## 4. pack tier との接続（使用データによる昇格・降格）

skill-pack-design.md の tier（official / community / experimental）は、初期判定が fixture / canary / eval の静的条件です。
本ループが稼働すると **使用データ** が加わり、tier を双方向へ動かせるようになります。

- **昇格材料**: FP rate の安定（L5）、suppression 密度の低さ（L4）、missed_issue feedback の少なさ（L1 / L7）
- **降格トリガー**: FP rate 悪化トレンド、同一 fingerprint の反復 suppress、eval 回帰の放置、同種 fix-pr trigger の反復

降格も「機械検知 → Issue 起票 → maintainer 判断」の流れとし、自動降格はしません（誤検知でカタログが暴れるのを防ぐ）。

### 接続の実装状態（2026-06-11 時点）

降格レビューの機械検知は次の 3 コマンドが供給します。tier 変更の判断材料として maintainer がレビュー時に参照してください。

- per-skill FP の悪化: `npm run eval:compare`（+3pt 超で regression 扱い、nightly が自動起票）
- 反復 suppress / 高 severity 滞留: `npm run suppression:analytics`
- 同種 feedback の反復（rule 昇格候補）: `npm run feedback:rules`

## 5. 実行計画

skill-pack-design.md の Phase B〜D と独立して進められるよう、別トラック（Phase L-1〜L-5）として定義します。

| Phase | 内容                                                                                | 変更範囲                           |
| ----- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| L-1   | 本設計の合意（本 PR）                                                               | docs のみ                          |
| L-2   | L1（feedback CLI + JSONL）と L2（feedback:apply スクリプト）の実装                  | src / scripts / schemas            |
| L-3   | L3（eval 回帰の自動起票）と L4（suppression 分析）の実装                            | scripts / GitHub Actions workflows |
| L-4   | L5（FP 時系列）・L6（rule 昇格検出）+ pack tier への使用データ接続                  | scripts / registry.yaml            |
| L-5   | L7（fix-pr trigger）を週次候補抽出や issue 起票へ拡張し、修正PR学習ループを半自動化 | scripts / GitHub Actions workflows |

L-2 以降は `src/` に触れるため、AGENTS.md の「Ask before editing」に従い個別 PR で承認を取ります。

## 6. 非ゴール

- skill 本文（SKILL.md）の自動書き換え。生成するのは雛形と提案までとし、適用は必ず人間の PR レビューを通す
- 自動 tier 降格（§4 の通り、検知と起票までを自動化し判断は maintainer が行う）
- feedback の自動分類（taxonomy への分類は当面レビュー実行者の入力とし、分類の自動推定は L-4 以降の検討事項とする）
- 修正PRからの元PR推定・owner skill 推定の完全自動化（初期は人間が確認し、将来は候補抽出までに留める）
