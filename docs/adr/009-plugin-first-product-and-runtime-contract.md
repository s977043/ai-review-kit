# ADR-009: Plugin-first Product Boundary—Runtime Adapter と Review Judgment の分離

## Status

Accepted—#2012（親 Epic #2011）で、River Review の第一級配布面を Claude Code / Codex Plugin として固定し、Runtime Adapter が Review Judgment を再定義しない不変条件を記録します。本 ADR が扱うのは配布境界と不変条件の宣言までです。検査スクリプトの実装、および Flow / Agent / Execution Manifest の schema は含みません。

## Context

### 現在の配布資産（実測）

正本の manifest は [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json) と [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json) の 2 つです。両者が宣言する資産は同一ではありません。

| 宣言            | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json`                               |
| --------------- | ---------------------------- | --------------------------------------------------------- |
| `skills`        | `./skills/agent-skills/`     | `./skills/agent-skills/`（同一値）                        |
| `commands`      | `./commands/*.md` 7 本       | 宣言なし                                                  |
| `agents`        | `./agents/river-review.md`   | 宣言なし                                                  |
| icon            | `composerIcon`               | `interface.composerIcon`（同一値）                        |
| host 固有の表示 | なし                         | `interface`（displayName / category / capabilities ほか） |

2 つの manifest が参照する実体パスは `commands/` `agents/` `skills/agent-skills/` `assets/` の 4 系統です。`.claude/**` または `.codex/**` を指す参照は 1 件もありません（両ファイルの全文読み取りによる実測）。

### すでに機械検証されているもの

[`scripts/validate-plugin-manifest.mjs`](../../scripts/validate-plugin-manifest.mjs)（`npm run plugin:validate`、全 541 行）は次を検査します。

- 2 つの manifest の `version` が `package.json` と一致すること（`:342` と `:440`）
- `.claude-plugin` 側の参照パスが実在すること（`:359`）
- 2 つの manifest 間の parity 6 組。`skills` / `repository` / `displayName` / `composerIcon` / `homepage` / `author.name` が対象である（`checkCrossManifestParity` `:161`）
- `commands/` と `agents/` に置いた資産が manifest へ登録済みであること（逆方向ドリフト検査 `:191`）

一方で「host 固有ディレクトリを配布資産として参照しない」および「host 固有ファイルへ Review Judgment を複製しない」を検査する仕組みは、同スクリプトに存在しません。

### 先行する決定との関係

- #1045 は CLI-first アーキテクチャを導入した。その内容は [`docs/CLI-architecture.md`](../CLI-architecture.md) の「Thin adapter 原則」節へ落ちており、同節は「正規実行面はメイン CLI（`src/cli.mjs`）である」と書いている
- #1446 は 2 つの事実を記録している。npm 未公開ゆえ `npx river-review` が原理的に失敗すること、および CLI 抜きで `review-team` skill の手順をエージェントが直接実行して設計どおりの出力へ到達したことである。[`README.md`](../../README.md) `:86` も配布 2 チャネルと npm 非公開を宣言している
- ADR-006（[`006-model-aware-review-prompt-compiler.md`](./006-model-aware-review-prompt-compiler.md)）は「Model Profile は Review Judgment を変更してはならない」を不変条件として置いている

この 3 つを重ねると、配布面の優先順位が文書間で一意に読めません。「正規実行面は CLI」と「利用者は CLI 抜きで使う」が別々の文書へ並んでいるためです。

## Decision

### D1—配布面の優先順位を固定する

River Review の第一級の利用面かつ配布境界は Plugin とします。

| 順位 | 配布面                     | 位置づけ                                   | 利用者にとっての必須性 |
| ---- | -------------------------- | ------------------------------------------ | ---------------------- |
| 1    | Claude Code / Codex Plugin | end-user distribution / primary UX         | 必須                   |
| 2    | GitHub Actions             | CI integration                             | CI 利用時のみ必須      |
| 3    | repository-local CLI       | contributor / 決定論の accelerator / debug | 必須ではない           |
| 4    | MCP / shell                | optional integration                       | 必須ではない           |

npm 公開は前提にしません。この点は `README.md` `:86` の既存宣言を変更しません。

### D2—CLI は共通実行エンジンであり、利用者の必須依存ではない

本 ADR は #1045 を取り消しません。CLI-first が支配するのは「実行面が判断ロジックを持たない」という adapter 設計であり、「利用者がまず CLI を導入する」という配布順ではありません。読み替えは次のとおりです。

| 論点                 | #1045 系の既存記述               | 本 ADR での読み替え                                                  |
| -------------------- | -------------------------------- | -------------------------------------------------------------------- |
| 判断ロジックの置き場 | CLI 側に置き、adapter は薄くする | 維持する。同じ制約が Plugin adapter へも及ぶ                         |
| 「正規実行面」の語   | メイン CLI                       | 自動化経路（GitHub Actions）における正規実行面と読む                 |
| 利用者の導線         | CLI 呼び出しを第一候補とする     | Plugin 経由の skill 実行を第一候補とする。#1446 の実測経路に合わせる |

したがって #1045 と #1446 は矛盾しません。両者は別の軸（判断の置き場と配布の順序）を規定しており、本 ADR がその軸の違いを明示します。

### D3—Runtime Adapter Invariants

> Runtime Adapter may change invocation mechanics, but MUST NOT redefine Review Judgment.

Review Judgment に属し、adapter 側へ複製してはならない対象は次のとおりです。

- skill の判断基準
- severity の語彙と対応関係
- gate / decision の意味
- completion の意味
- human boundary（人間が保持する権限）
- finding に要求する証跡

invocation mechanics に属し、adapter が変えてよい対象は次のとおりです。

- 起動方法（slash command / native subagent / エージェントによる直接実行）
- 表示メタデータ
- host 固有の権限宣言
- ファイル入出力の経路

不変条件は 4 つとし、いずれも述語の形で書きます。

| ID   | 述語                                                                                                                                              | 現在の検証手段                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| RA-1 | `.claude/**` / `.codex/**` / 2 つの plugin manifest は、Review Judgment の正本を定義しない                                                        | 未実装。追加先は `scripts/validate-plugin-manifest.mjs`   |
| RA-2 | manifest が参照する実体パスは host 非依存のトップレベル（`commands/` `agents/` `skills/` `assets/`）に限り、`.claude/**` / `.codex/**` を含まない | 未実装。現況は適合（Context の実測）                      |
| RA-3 | 2 つの manifest の `skills` は同一パスを指す                                                                                                      | 実装済み。`checkCrossManifestParity` `:161`               |
| RA-4 | 2 つの manifest の `version` は `package.json` と一致する                                                                                         | 実装済み。`validate-plugin-manifest.mjs` `:342` と `:440` |

RA-1 と RA-2 を検査へ落とす際の述語は、次の 3 要素で定義します。実装は本 ADR の範囲外です。

1. 対象パス集合—`.claude/**`、`.codex/**`、`.claude-plugin/*.json`、`.codex-plugin/*.json`
2. 禁止パターン集合—severity 語彙の対応表、gate / decision の判定条件、completion の判定条件、finding の証跡要件の定義
3. 除外条件—同一ファイル内に SSoT（[`pages/reference/review-policy.md`](../../pages/reference/review-policy.md) / [`docs/review/output-format.md`](../review/output-format.md) / `skills/**`）への参照を持つ派生記述

判定不能な場合は違反として扱います。本リポジトリの fail-safe は目立つ側へ倒す方針であり、ADR-008 が severity 不明を major へ倒す既存実装を根拠として記録しています。

### D4—資産の配置規則

| 分類                     | 置き場所                                                                                 | 配布対象   | Review Judgment の正本 |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------- | ---------------------- |
| runtime-independent 資産 | `skills/**` `commands/**` `agents/**` `schemas/**` `docs/review/**` `pages/reference/**` | 参照される | 持つ                   |
| adapter 資産             | `.claude-plugin/*.json` `.codex-plugin/*.json`                                           | 配布される | 持たない               |
| host-local 開発設定      | `.claude/**` `.codex/**`                                                                 | 配布しない | 持たない               |

adapter 資産が持ってよいのは宣言と表示だけです。host-local 開発設定は派生記述のみを置き、SSoT への参照を伴わせます。

### D5—host-specific fallback

Codex 側の manifest は `commands` と `agents` を宣言しません（Context の実測）。そのため Claude Code の slash command と native subagent は Codex では解決しません。fallback は次の順で定義します。

1. host が command / agent の primitive を持つ場合、それを adapter として使う
2. 持たない場合、エージェントが対応する skill の手順を直接実行する（#1446 が実測した経路）
3. どちらも取れない場合、repository-local CLI（contributor 経路）へ退避する

fallback が変えるのは起動経路だけです。選ばれる skill、severity、gate、completion の判定は 3 経路で同一でなければなりません。

### D6—version pinning と互換性

- plugin の version は `package.json` の version と同値とし、更新主体は release-please だけとする。[`scripts/sync-plugin-fields.mjs`](../../scripts/sync-plugin-fields.mjs) `:11` は version を同期対象から明示的に外し、一致の検査は `validate-plugin-manifest.mjs` が担う
- 互換性の単位は skill の id と version であり、adapter の version ではない。adapter だけの変更（表示メタデータ、host 固有の宣言）は Review Judgment の互換性へ影響しない。逆に `skills/**` の判断基準の変更は、adapter を変更しなくても互換性へ影響する
- host 側の設定によっては配布物の自動更新が働かない。版ズレを疑う場合の診断手順は [`docs/runbook/plugin-cache-purge.md`](../runbook/plugin-cache-purge.md) に従う

### D7—既存 manifest からの移行方針

現況の 2 つの manifest は本 ADR の規則へすでに適合しており、フィールドの書き換えは不要です。移行として残るのは次の 3 点です。

1. RA-1 と RA-2 の検査を `scripts/validate-plugin-manifest.mjs` へ追加する。本 ADR では実装しない
2. [`.claude/rules/review-core.md`](../../.claude/rules/review-core.md)（40 行）の扱いを派生記述として固定する。同ファイルは severity の対応表を持つが、冒頭で SSoT 3 本を参照しており、manifest からも参照されないため配布対象ではない。RA-1 の除外条件に該当する
3. `docs/CLI-architecture.md` の「Thin adapter 原則」節から本 ADR を参照し、「正規実行面」の語が自動化経路を指すことを読者が辿れるようにする

## Non-goals

- Plugin runtime そのものの書き換え
- host ごとの Skill fork
- npm 公開
- Flow / Agent / Execution Manifest の schema 定義と実装。これは #2013 / #2014 / #2015 の責務である
- RA-1 と RA-2 の検査スクリプトの実装
- 既存 manifest のフィールド追加と削除
- CLI の廃止、および `docs/CLI-architecture.md` が記録する 2 系統 CLI の統合

## Consequences

- 配布面の優先順位が 1 か所で決まる。skill / command の案内文を「CLI をまず入れる」導線へ戻す余地が減る
- Codex 側で slash command と native subagent が解決しない事実を、欠陥ではなく fallback の対象として扱える
- RA-1 と RA-2 の担保は当面レビューに依存する。宣言だけでは機械的に守られないため、検査を追加するまでは違反の入り込む余地が残る
- adapter 資産へ判断を足したくなった場合の昇格先が明確になる。昇格先は `skills/**`、`schemas/**`、SSoT ドキュメントのいずれかであり、host 固有ファイルではない
- 本 ADR は利用者から見た挙動を変えない。manifest と skill のどちらも変更しないため、リリース時の互換性へ影響しない

### 再参入条件

D1 の優先順位は、次のいずれかが成立した時点で再検討します。

1. npm 公開を行う方針転換があること。この場合、配布面の順位と「必須性」の列が変わる
2. host 側の primitive が変わり、D5 の fallback 3 段のいずれかが恒常的に到達不能になること

## 関連

- #2011—Plugin-first Continuous Review Protocol（親 Epic。本 ADR は Phase 1 にあたる）
- #2012—本 ADR の起票元
- #1045—CLI-first architecture / common execution surface
- #1446—Plugin 配布と CLI 非依存のエージェント実行
- ADR-006—Model-Aware Review Prompt Compiler（Review Judgment を変えない不変条件の先例）
- ADR-008—`actionability` 軸の吸収（fail-safe を目立つ側へ倒す方針の出典）
