---
title: PlanGate CLI 安定化ロードマップ
---

`river review plan` / `river review exec` / `river review verify` は、PlanGate をはじめとする上流ワークフローが生成した artifact を入力として、レビュー計画・実行・再監査を行う CLI サブコマンド群です。これらは River Review の最大の差別化要素ですが、**仕様（spec）と実装・CI・配布の間にドリフトがあり**、導入側が安定的に利用できる状態にありません。

本ドキュメントは [Issue #802](https://github.com/s977043/river-review/issues/802) に対応し、(1) 現状の契約ドリフトの棚卸し、(2) 公開エントリポイントの方針確定、(3) 安定化目標バージョンのロードマップ、(4) 解消すべき仕様不整合と推奨統一契約を定義します。

> 関連: [Artifact Input Contract](./artifact-input-contract.md) / [Stable Interfaces](./stable-interfaces.md) / [`river review plan` 仕様](./cli-review-plan-spec.md) / [`river review exec` 仕様](./cli-review-exec-spec.md) / [`river review verify` 仕様](./cli-review-verify-spec.md) / `docs/CLI-architecture.md`

## 現状の契約ドリフト棚卸し

以下は spec が宣言する契約と、実装・CI・配布の実態の差分です。

| 項目                     | spec の宣言                                                                                                               | 実装・配布の実態                                                                                                                                    | 影響                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `river review *` の所在  | 3 spec とも「CI から安定して呼び出せる契約」と記述                                                                        | `review` サブコマンドは **Runner CLI**（`runners/cli/`、npm 未公開・private bin）にのみ存在。`docs/CLI-architecture.md` 参照                        | `npx river review …` は **メイン CLI に解釈され unknown command エラー** |
| 公開エントリポイント     | 暗黙に `river review plan/exec/verify` を公開契約として提示                                                               | メイン CLI（`src/cli.mjs`、`package.json#bin` 登録）に `review` コマンドは**実装済み**（`review plan` / `review exec` / `review verify`、v0.68.0+） | 動線は確立済み                                                           |
| artifact 設定経路        | [Artifact Input Contract](./artifact-input-contract.md) が `river.config.*` の `artifacts` セクションを「定義済み」と記述 | `src/config/schema.mjs` に `artifacts` キーが存在しない                                                                                             | 設定ファイル経由の artifact パス指定が実際には機能しない                 |
| `--output` の意味論      | `plan` spec: `--output <format>`（`text`/`markdown`/`json`）+ `--output-file <path>`                                      | `exec` / `verify` spec: `--output <path>`（出力先パス、`-`=stdout）+ `--format <value>`                                                             | **同名フラグが plan と exec/verify で逆の意味**。CI スクリプトが共有不能 |
| 終了コード               | `plan` spec: `0`/`1`/`2`/`3`（4 値、`3`=設定エラー）                                                                      | `exec` / `verify` spec: `0`/`1`/`2`（3 値、`2`=設定エラー）                                                                                         | 設定エラーの exit code がサブコマンド間で不一致                          |
| GitHub Action マッピング | `plan` spec: 「`action.yml` inputs から本 CLI へのマッピングを提供する」                                                  | spec 本文に「未実装、別途対応予定」と明記                                                                                                           | Action 経由の安定動線が未確立                                            |
| CI ジョブ                | —                                                                                                                         | `.github/workflows/plangate-review.yml` が `PLANGATE_REVIEW_CLI_READY` フラグで placeholder 動作（CLI 未接続でも成功しうる）                        | CI green が「CLI が動く」ことを保証しない（偽陽性リスク）                |

## 公開エントリポイントの方針（確定）

**`river review plan` / `river review exec` / `river review verify` の安定版公開エントリポイントは、メイン CLI（`src/cli.mjs`、`package.json#bin` の `river` / `river-review`）に実装する。**

理由:

- メイン CLI は npm `bin` に登録され、GitHub Action 本番経路（`runners/github-action` → `src/cli.mjs`）でも使われる唯一の安定動線である。
- Runner CLI（`runners/cli/`）は npm 未公開・スキル開発者向け実験的インターフェースであり、`docs/CLI-architecture.md` でも置き換え計画は無いと明記されている。Runner CLI 側の `review` は **簡易確認用** の位置づけを維持し、安定 CI 契約は担わない。
- この方針により、[Issue #801](https://github.com/s977043/river-review/issues/801)（レビューエンジンとドキュメントサイトのパッケージ分離）が分離境界を設計する際の **public API の所在が一意に固定**される。#801 はこの境界（`src/cli.mjs` 上の `review` サブコマンドと、それが依存する `src/lib/*` の import 境界）を壊してはならない。

> このエントリポイント決定は #802 のスコープ内で「決定」のみを行う。実装（メイン CLI への `review` サブコマンド追加）は後続フェーズ（下記 Phase 3）で設計承認のうえ着手する。

## 安定化目標バージョンのロードマップ

安定性ラベルは [Stable Interfaces](./stable-interfaces.md) の語彙に従う。各サブコマンドの目標を 3 段階で定義する。

| サブコマンド          | 現状                | Alpha（契約固定）                                               | Beta（dry-run E2E）                         | Stable（CI 組込み可）                                |
| --------------------- | ------------------- | --------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `river review plan`   | spec のみ（未接続） | spec 不整合解消 + メイン CLI 実装 + `--plan-only --output json` | PlanGate sample fixture での E2E（dry-run） | `plangate-review.yml` の feature flag を実接続へ切替 |
| `river review exec`   | spec のみ（未接続） | spec 不整合解消（plan と同一の出力/終了コード契約に統一）       | plan→exec の連結 E2E（advisory）            | Action inputs マッピング提供                         |
| `river review verify` | spec のみ（未接続） | spec 不整合解消（exec と同一 shape）                            | exec→verify の連結 E2E（META finding 検証） | CI 組込みガイド公開                                  |

AI-agent-template の C-1 / C-2 ワークフローへの組込みは、各サブコマンドが **Beta（dry-run E2E 通過）** に到達した時点で「計画可能」、**Stable** で「組込み実行可能」とする。

## 解消すべき仕様不整合と推奨統一契約

以下は安定化（Alpha）の前提となる、spec 間の不整合と推奨される統一方針です。**契約の破壊的変更を伴うため、確定・spec 改訂は後続 PR で設計承認のうえ実施する**（本ドキュメントは推奨案の提示まで）。

### 1. `--output` / `--format` の意味論統一

- 現状: `plan` は `--output <format>` + `--output-file <path>`、`exec`/`verify` spec は `--output <path>` + `--format <value>`。
- **決定（#802 Phase 3、2026-05-18 承認済み）: `plan` 側に統一する**（`--output <format>` = 形式、`--output-file <path>` = 出力先）。`exec`/`verify` spec を改訂して `--output <path>` を `--output-file <path>` に、`--format` を `--output <format>` に移行する。`--format` は review 系（plan/exec/verify）の互換 alias として受理し、canonical は `--output <format>`。`--output` と `--format` が両指定かつ不一致なら設定エラー（exit 3）。
  - 当初案（exec/verify 側 `--output <path>` への統一）を撤回した理由は次の矛盾である。グローバル `--output <mode>`（`river run`、`text|markdown|json|yaml`）と意味が反転する。`river review plan` の実装実態（`--output` を honor せず常に JSON、宛先は `--output-file`）と食い違う。`plangate-review.yml` 自身の `--output json --output-file` 呼び出しとも矛盾する。`plan` 側統一なら global flag・実装・workflow と整合し破壊が最小になる。
  - バージョニング: `review plan --output` は一度も honor されておらず `exec`/`verify` は未実装のため runtime breaking は無い。Beta spec の訂正としてリリースノートに明記する。

### 2. 終了コードの統一

- 現状: `plan` は `0`/`1`/`2`/`3`（`2`=警告のみ、`3`=設定エラー）、`exec`/`verify` は `0`/`1`/`2`（`2`=設定エラー）。
- 推奨: **4 値（`0`/`1`/`2`/`3`）に統一**。`2`=警告のみ、`3`=設定エラー。`exec`/`verify` は現状 `2`=設定エラーだが、CI が `!= 0` を失敗として扱う限り後方互換は保たれる（[Stable Interfaces](./stable-interfaces.md) の最小契約 `0`/`1` とも非互換ではない）。`plan` の `--warn-on`/`advisory` 区分を 3 サブコマンド共通にすることで、ゲート判定ロジックを統一できる。
  - **supersede（#1709、2026-08 決着）**: 「`3`=設定エラー」のうち引数エラーを含める部分は #1709 が上書きした。parse 層が検出する引数エラー（未知オプション・余剰 positional・値の欠落や不正値）は全コマンド横断で `1` に統一され、`3` はハンドラ層の設定エラーと `--gate` の ESCALATE に限定される。

### 3. artifact 設定スキーマ

- 現状: [Artifact Input Contract](./artifact-input-contract.md) は `river.config.*` の `artifacts` セクションを前提化しているが `src/config/schema.mjs` に未定義。
- 推奨: **PlanGate 固有の `plangate.artifacts.*` ではなく、汎用 `artifacts.<artifactId>` を `src/config/schema.mjs` に追加**。Artifact Input Contract 自体が PlanGate 非依存を明示しているため、PlanGate 専用キーは設計と逆行する。PlanGate 向けの既定パス集合が必要であれば `artifacts.profiles.plangate` のような optional profile として後付けする。

## フェーズ計画

| Phase   | 内容                                                                                                               | 自律実行可否                      |
| ------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Phase 1 | 本ロードマップ公開（契約ドリフト棚卸し・エントリポイント方針確定・安定化バージョン定義・統一案提示）               | 可（doc のみ・追加型）            |
| Phase 2 | 汎用 `artifacts.*` スキーマを `src/config/schema.mjs` に追加 + artifact resolver + unit test                       | 設計承認が必要（schema 変更）     |
| Phase 3 | メイン CLI への `river review plan --plan-only --output json` 最小実装 + PlanGate fixture E2E + workflow flag 整理 | 設計承認が必要（`src/` CLI 実装） |

Phase 2 以降は本ロードマップで確定した方針（エントリポイント・統一契約）を前提に、各 PR で設計を提示して承認を得たうえで着手する。各 PR は単独で `npm run lint && npm test` を通し、`pages/` 変更時は `npm run check:links:local` を実行する。

## 関連ドキュメント

- [Artifact Input Contract](./artifact-input-contract.md) — 入力アーティファクトの契約
- [`river review plan` 仕様](./cli-review-plan-spec.md) / [`river review exec` 仕様](./cli-review-exec-spec.md) / [`river review verify` 仕様](./cli-review-verify-spec.md)
- [Stable Interfaces](./stable-interfaces.md) — 安定契約の語彙とバージョニング
- [Review Artifact](./review-artifact.md) — 出力 JSON スキーマ
