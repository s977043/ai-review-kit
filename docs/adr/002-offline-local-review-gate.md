# ADR-002: CI 不可用時のためのオフライン（rules-only）ローカルレビューゲートを追加する

## Status

Accepted—implemented via `--offline` / `--rules-only` (#1071). `isLlmEnabled()` honors `RIVER_OFFLINE`, so AI is force-disabled and the review falls back to deterministic heuristics. The `--fail-on` / `--warn-on` / `--output json` gating works unchanged.

## Context

River Review の本番経路は GitHub Action からメイン CLI (`src/cli.mjs`) の `river run` を呼び、OpenAI API による AI レビューを実行する。しかし OpenAI API が利用不能な期間（API キー未設定・billing 制約・ネットワーク断・レート制限）には次の問題が起きる。

- 自動レビューが空振りし（#1067）、PR の Auto-approve 判定（critical=0 / major=0）が生成されない。
- やむを得ず管理者権限マージ（`--admin`）に頼る際、その正当性を示すローカルなエビデンスが残らない。

一方で、既存 CLI には `--base <ref>`（差分）/ `--fail-on <sev>`（exit 1）/ `--warn-on <sev>`（exit 2）/ `--output json` の判定・gating 基盤が**すでに存在する**（`src/cli.mjs`）。不足しているのは「OpenAI を呼ばずに、決定論的に判定できる範囲だけでローカル実行する」モードである。

## Decision

既存 `river run` に**オフライン（rules-only）モード**（暫定フラグ `--offline` / `--rules-only`）を追加する。AI 呼び出しをスキップし、以下の決定論的に判定可能な findings のみでレビュー結果・Severity・exit code・JSON を生成する。

- `.claude/rules/review-core.md` の禁止事項（差分外推測・一般論・無関係指摘 等）のうち静的に検出できるもの
- 既存のカスタム静的チェック / canary（ADR/#1070 の責務分界と整合）
- doc-only PR の到達性・リンク切れ等の静的観点（#1068 と整合）

出力は既存 `--output json` スキーマ（`findings[]` / `severity`）に準拠し、`--fail-on` / `--warn-on` の exit code 分岐をそのまま使う。これにより CI 不可用時でも次のコマンドで Auto-approve 判定をローカル再現し、`--admin` マージの根拠ログ（critical=0 / major=0）として添付できる。

```bash
river run . --base main --offline --fail-on critical --output json
```

## Non-Goals

- AI レビューの置き換え（offline は**補完**。意味的レビューは AI 経路が担う）。
- 新規の重量級の静的解析エンジンの実装（既存ルール / canary / 静的観点の範囲に限定）。
- Runner CLI (`runners/cli/`) 側への実装（本番経路のメイン CLI に閉じる）。

## Consequences

### Positive

- CI / OpenAI 不可用時もローカルで Severity 判定 + exit code を得られ、`--admin` マージの監査証跡が残る。
- 既存の `--fail-on` / `--output json` 基盤を再利用するため追加表面が小さい。
- #1067（API 不在時の空振り）への構造的な緩和になる。

### Negative

- offline モードの判定範囲は決定論的部分に限られ、AI レビューより検出力は低い（「ゲートの最低保証」と位置づける）。
- ルールベース判定の網羅度は `review-core.md` の充実度に依存する。

## Rollout Plan

1. `river run --offline` フラグの仕様確定（出力スキーマは既存踏襲）。
2. 決定論的 findings の抽出器（既存ルール / canary / doc 静的観点）。
3. exit code 分岐の既存 `--fail-on` / `--warn-on` への接続。
4. `--admin` マージ運用での根拠ログ添付ガイド（`docs/runbook`）。

## 背景（提案の発端）

PocketEitan の自律開発運用で、GitHub Actions の billing 制約により River Reviewer CI が長期間 systemic に失敗し、複数回のリリースを `--admin` マージで通した。OpenAI 不要のローカル判定があれば、その間も Auto-approve 基準の充足をローカルで実証できた。river-review #1071 の対応設計（実装の可否はメンテナが判断・本 ADR は提案）。
