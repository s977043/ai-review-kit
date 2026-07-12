# Zenn ウォッチ 検討 Runbook

Zenn の AI レビュー/コードレビュー関連記事を定期的にウォッチし、river-review への取り込み（skill/rule/docs 化）を検討するための runbook です。

## いつ使うか

- `.github/workflows/zenn-watch.yml` が作成する digest issue（label: `zenn-watch-digest`）に新着記事が追記されたとき。
- 定期セッション（隔週〜週次目安）で digest issue のトリアージを回すとき。

## 背景

- 過去の成功パターンは #1452（`/simplify` 概念取り込み）・#1470（Unknown Coverage 概念取り込み）＝「調査 → 既存カバレッジ/ギャップ分析 → 段階導入」。
- ADR-005（[`docs/adr/005-review-learning-loop-incremental-extension.md`](../adr/005-review-learning-loop-incremental-extension.md)）は、Zenn 記事（nexta\_）を参考にしつつ**自動化度をそのまま持ち込まない**判断の前例。本 runbook も同じ原則（HITL、report-only）に従う。
- 収集範囲は現状 **コードレビュー トピックのみ・週次収集**に限定している。実測で `コードレビュー` は 20 件のフィード上限が約 11 日分（≈1.75 本/日、週 ≈12 件）に相当し、週次取得で取りこぼさない。`claudecode` / `aiエージェント` / `llm` などの広域トピックは 1 日未満で 20 件が埋まるため今回のスコープには含めない（将来 P1.5 で日次化 or 非公式 API のページング opt-in を検討）。

## 検討フロー

digest issue に新着記事が追記されたら、以下の順で判定する。**新しいプロセスは作らず、既存の仕組みに接続する**。

### 1. 選別質問（トリアージ）

digest issue の各記事に対して、上から順に answer する。

1. **レビュー/コードレビューに関係する内容か。**—無関係なら見送り（トピック自体を `コードレビュー` に絞っているため多くは該当するはずだが、周辺話題の記事も混ざりうる）。
2. **既存 skill/rule/docs でカバー済みか。**—`skills/registry.yaml`・`agent-skills/`・`.claude/rules/`・`docs/review/` と照合する。#1452/#1470 のカバレッジ表と同型の突合を行う。
3. **真のギャップか。**—2 で埋まらない残余のみが候補になる。
4. **report-only / HITL 契約に乗るか。**—ADR-005 の原則どおり、記事が主張する自動化度（自動修正・自動マージ等）をそのまま持ち込めるかを確認する。乗らない場合は「発想だけ取り込み、実装は HITL に合わせて縮小する」か、見送るかを判断する。

4 つすべてを満たした記事だけが採用候補として次のステップに進む。

### 2. 既存実装の事前調査

採用候補について、Issue 化する前に `/propose-issue` 型の調査を行う（`.claude/commands/propose-issue.md`）。

- `src/`・`schemas/`・`scripts/`・`tests/`・`runners/` を横断してキーワード検索する。
- `git log --all --oneline | grep -i "<keyword>"` で関連コミットを確認する。
- `gh pr list --state merged --search <keyword>` / `gh issue list --state all --search <keyword>` で既存 PR・Issue を確認する。
- 既に実装済み、または部分実装なら Issue のスコープをそれに合わせて修正する（新規 Issue を作らない、または「既存 Y の拡張」に縮小する）。

### 3. 概念輸入時の命名ゲート

Zenn 記事のテクニックを概念として再実装する場合は、`skills/README.md` の **Import decision framework (Q0–Q5)** に従う。

- Q0 で「概念/技法の再実装」に分類し、原則リネームをデフォルトにする。
- Q1–Q5 を順に評価し、最初に確定したゲートを採用する。
- 採用した skill/rule の冒頭に **由来（`inspired by <zenn URL>`）を明記**する（nominative fair use。実装や推奨を著者が保証しているかのような endorsement 表現は禁止）。

### 4. Codify（improvement-flow への合流）

採用が確定したら、`docs/development/improvement-flow.md` の Step 1–8（学びの整理 → 成果物の分類 → ドラフト → セルフレビュー → multi-agent review → 指摘の適用 → PR 作成 → メモリ保存）に従って codify する。分類先（CLAUDE.md guard / command / docs / skill）は同ドキュメントの Step 2 の表を使う。

**digest issue 側は候補提示までに留める。** 採用の実体（実装・PR）は improvement-flow 側で行い、digest issue には結果へのリンクを残すだけにする（HITL の浸食を防ぐ、ADR-005 準拠）。

## 記録先（disposition の残し方）

- **既読・トリアージ状態**: digest issue（label: `zenn-watch-digest`）本文のチェックリストで管理する。記事1件＝1チェックリスト行。
- **disposition（採用/見送り）の記録**: 該当のチェックリスト行にチェックを入れ、判断理由を digest issue へのコメントとして残す（例: 「見送り: 選別質問2で `docs/review/viewpoints.md` の既存項目と重複と判定」）。チェックを入れるのは選別質問1〜4の判定が終わった時点とし、採用候補が improvement-flow を経て実装 PR にまで至った場合は、そのコメントに PR/Issue 番号を追記する。
- **採用結果の実体**: `improvement-flow.md` の成果物（skill / `.claude/rules/` / docs / ADR）に従う。
- **転用しないもの**: `.river/feedback/*.jsonl` は finding 単位のレビュー採否記録専用（ADR-005 で確定）。外部記事の取り込み管理をここに混載しない。

## 収集の仕組み（P1・機械化）

- `.github/workflows/zenn-watch.yml` が週次 cron（+ `workflow_dispatch`）で `https://zenn.dev/topics/コードレビュー/feed`（公式 RSS）を取得する。
- 既読突合は digest issue 本文そのものを台帳として使う（新着記事の URL が本文に既出かどうかで判定）。repo への commit は行わない（bot push の再帰トラップ回避、CLAUDE.md「N of N required checks are expected」ガード参照）。
- 新着があれば日付順で digest issue 本文に追記する。**保存するのは URL・タイトル・著者・公開日のみで、記事本文は保存しない**（RSS は要約のみで本文非含有のため、そもそも本文は取得していない）。
- 新着ゼロの週は issue を更新しない。
- フィード取得に失敗した場合は `scheduled-check` ラベルの通知 issue を作成する（`weekly-gc.yml` と同じ dedup パターン）。

## 拡張時の注意

- 広域トピック（`claudecode` 等）を追加する場合は、20 件のフィード上限に収まるかを実測してから判断する（収まらない場合は収集を日次化し、人間トリアージは週次のまま分離する）。
- 非公式 API（`https://zenn.dev/api/articles`）はページングで 20 件上限を超えられるが、無告知で仕様変更されうる内部 API であり、既定経路にはしない。使う場合は opt-in とし、低頻度・条件付きアクセスを維持する。
- LLM による一次選別（案C）は `OPENAI_API_KEY` 未設定のため見送り中。設定後に再検討する。

## 関連

- Tracking issue: 「tracking: Zenn AI レビュー/コードレビュー記事の定期ウォッチと取り込み検討」（本 runbook 作成と前後して作成）
- ワークフロー: [`.github/workflows/zenn-watch.yml`](../../.github/workflows/zenn-watch.yml)
- `docs/adr/005-review-learning-loop-incremental-extension.md`—自動化度を持ち込まない判断の前例
- `docs/development/improvement-flow.md`—codify フロー本体
- `.claude/commands/propose-issue.md`—既存実装調査の手順
- `skills/README.md`—Import decision framework (Q0–Q5)
- `.github/workflows/weekly-gc.yml`—digest issue dedup / 失敗時通知パターンの元ネタ
