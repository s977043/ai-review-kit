# 設計検討メモ: #1255 analyzeTestImpact() の実行計画への接続

- Status: 実装済み（B = 信号公開 + D = フラグ opt-in 注入）
- Related issue: #1255 `feat(planner): wire analyzeTestImpact() into execution plan for high-risk diffs`
- 目的: Codex / Antigravity を含むレビューで方針を決めるための論点整理

## 1. 背景

`src/lib/test-impact.mjs` の `analyzeTestImpact(changedFiles)` は実装済みだが、CLI / プランナー / スキル選択のいずれからも import されておらず、事実上デッドコードになっている。

`analyzeTestImpact()` は変更ファイルを分類し、次の `riskLevel` を返す。

- `high`: アプリコードの変更があり、テストファイルの変更がゼロ
- `medium`: アプリ変更があり、ギャップファイルがアプリ数の半分以上
- `low`: それ以外

Issue の狙いは「バグ修正や複雑なロジック変更などの高リスク差分に対して、downstream のテスト提案スキルが自動選択されない」状態を解消すること。

## 2. 完了条件（Issue 記載）

- [ ] `analyzeTestImpact()` が `buildExecutionPlan` または planner から呼ばれている
- [ ] `riskLevel: 'high'` の diff に対してテストスキルが実行計画に含まれる（単体テストまたは fixture で検証）
- [ ] `npm test` が green
- [ ] `npm run lint` が green

## 3. 現状の関連コード

- `runners/core/review-runner.mjs`
  - `buildExecutionPlan(options)`（L181〜）: `selectSkills()` で phase / applyTo / context により候補を絞り、planner あり/なしの3つの return 経路を持つ。
  - `selectSkills(skills, options)`: `evaluateSkill` が `phase` 一致を要求するため、現状は現在フェーズのスキルしか `selected` に入らない。
- 対象スキル（注入候補）
  - `test-existence`—**phase: downstream**, severity: major
  - `coverage-gap`—**phase: downstream**, severity: major
- ガード: `docs/development/pipeline-params-checklist.md`
  - `buildExecutionPlan` に**新パラメータを追加**する場合の call site チェックリスト。
  - 本件は `changedFiles`（既存パラメータ）から内部計算し、出力フィールドを足すだけなので**入力シグネチャは不変**。ただし**出力フィールド追加**はスナップショットテストに影響する。

## 4. 設計上の中心的な緊張

対象テストスキルは両方 `phase: downstream`。一方 Issue の意図は「**midstream の高リスク差分**にも downstream テストスキルを出す」=**フェーズを跨いだ強制注入**。

ここが論点。`selectSkills` の phase フィルタを高リスク時だけバイパスして downstream スキルを注入するのか、それともフェーズ内に閉じるのかで、実装と振る舞いが大きく変わる。

## 5. ブラストレディウス（重要）

`analyzeTestImpact` は「アプリ変更あり・テスト変更ゼロ」を `high` と判定する。テストで多用される fixture `createRepoWithSilentCatchChange`（`src/app.js` を変更し、テストファイルを伴わない）は**まさに high 判定**になる。

このため、フェーズ横断で無条件に強制注入すると:

- `tests/cli.test.mjs` の markdown 出力テスト（スキル ID を固定 assert）
- `tests/review-runner.snapshot.test.mjs`（実行計画スナップショット）
- `tests/skill-routing-regression.test.mjs`

など、**midstream dry-run レビュー全般**に downstream スキルが混入し、多数の既存テストが更新対象になる。これは Issue の意図どおりの振る舞い変更だが、影響は広い。

## 6. 選択肢とトレードオフ

### A. フェーズ横断で強制注入（Issue 原文に最も忠実）

- 内容: `riskLevel: 'high'` のとき、現在フェーズに関わらず2つの downstream テストスキルを `selected` に注入。
- 長所: Issue の狙い（midstream 高リスク差分のエスカレーション）を完全に満たす。
- 短所: 振る舞い変更が大きく、多数のテスト/スナップショット更新が必要。dry-run でも downstream スキルが出る是非（LLM 必須スキルとの整合）も要検討。

### B. testImpact を plan に公開するのみ（最小）

- 内容: `buildExecutionPlan` で `analyzeTestImpact()` を呼び、`testImpact` / `riskLevel` を plan・snapshot に出力。強制注入はしない。
- 長所: デッドコード解消。ブラスト半径は snapshot 更新程度で最小。後続の planner がこの信号を使える土台になる。
- 短所: 完了条件②「テストスキルが計画に含まれる」を**満たさない**（部分達成）。

### C. downstream フェーズ限定で注入

- 内容: `phase === 'downstream'` のレビュー時のみ、`riskLevel: 'high'` で2スキルを強制選択。
- 長所: ブラスト半径が小さい（midstream の既存テストに影響しにくい）。フェーズ整合性が保たれる。
- 短所: 「midstream 高リスク差分のエスカレーション」という Issue の中核は満たさない。

### D. フラグ/設定でオプトイン

- 内容: A の挙動を `RIVER_ESCALATE_TEST_SKILLS` や設定キーの背後に置き、既定 off。
- 長所: 既定の振る舞いを変えずに機能を提供。段階導入できる。
- 短所: 機能が既定で無効なので「自動選択されない」課題の体感解決が遅れる。設定面の追加コスト。

## 7. 推奨（たたき台）

二段構えを提案する。

1. まず **B**（testImpact の計算と plan への公開）を最小 PR として入れ、デッドコードを解消しつつ信号を露出する。
2. その上で **A or D** をフォローアップとして決める。A は Issue 完全達成だがテスト更新が大きい。リスクを抑えるなら D（既定 off で A の挙動）を経由し、検証後に既定 on へ。

C は phase 整合性こそ良いが Issue の中核を外すため、単独の最終解にはしにくい。

## 8. Codex / Antigravity への問い

- フェーズ横断注入（A）は River Review のレビュー設計思想と整合するか。それとも downstream はあくまで別フェーズとして分離すべきか。
- dry-run / LLM 無効時にも downstream テストスキルを出すべきか（現状 dry-run は heuristic スキルのみ）。
- 強制注入スキルは `selected` の先頭・末尾どちらに置くか。既存の `rankByImpactTags` 順位との関係。
- `medium` リスクの扱い（今回は対象外でよいか）。
- 既定 on（A）と既定 off（D）のどちらをファーストリリースにするか。

## 8.5 決定と一次実装（方針 B）

レビューの結果、**方針 B（testImpact を plan に公開するのみ）** を一次実装として採用した。

- `runners/core/review-runner.mjs` の `buildExecutionPlan` で `analyzeTestImpact(changedFiles)` を呼び出した。結果を `testImpact` として 3 つの return 経路すべて（早期 return / planner あり / planner なし）に top-level + `snapshot` で公開した。`riskAssessment` と同じ公開パターンに揃えた。
- **入力シグネチャは不変**のため `pipeline-params-checklist.md` の入力パラメータ chain への追記は不要。出力フィールド追加だが、既存スナップショットテストは当該フィールドを全項目 assert していないため更新不要だった。
- 強制注入（A）は行わないため、midstream dry-run への downstream スキル混入は発生しない（ブラスト半径は最小）。
- 検証: `tests/review-runner.test.mjs` に high / low の 2 ケースを追加。`npm test`（全 1518 件）と `npm run lint` が green。

## 8.6 フォローアップ実装（方針 D）

B の `testImpact.riskLevel` 信号を入力に、**方針 D（フラグ opt-in）** を実装した。

- 環境変数 `RIVER_ESCALATE_TEST_SKILLS`（`1` / `true` / `yes` / `on` で有効、既定 off）を追加。
- 有効かつ `testImpact.riskLevel === 'high'` のとき、`buildExecutionPlan` の選択結果に downstream テストスキル（`test-existence` / `coverage-gap`）を**フェーズ横断で注入**する。注入時は `skipped` から該当エントリを除去し、`selected` / `skipped` の二重計上を防ぐ。
- 注入は `selectSkills` 後・空判定前に行うため、3 つの return 経路すべて（早期 return / planner / 決定論）と空セレクション判定に一貫して反映される。
- **既定 off** なので baseline の選択結果・midstream dry-run の heuristic 挙動・既存スナップショットは不変。フラグ on は明示的なオプトインであり、dry-run でも downstream スキルが選択され得る点は利用者が許容する前提とする。
- 検証: `tests/review-runner.test.mjs` に flag off / flag on(high) / flag on(low) の 3 ケースを追加。`npm test`（全 1521 件）と `npm run lint` が green。

これで Issue 完了条件②（`riskLevel: high` の diff に対してテストスキルが実行計画に含まれる）を、既定挙動を変えずに opt-in で満たす。既定 on（方針 A）へ進める場合は、§5 の影響テスト群（snapshot / skill-routing-regression / cli）の更新を伴う別 PR とする。

### 残課題（A への移行時）

prune モードの planner は注入スキルを落とし得る。既定 on 化する際は、注入を planner 後に行うか、planner に escalation を伝える設計を検討する。

## 9. 影響を受けるテスト（事前棚卸し）

- `tests/review-runner.test.mjs`
- `tests/review-runner.snapshot.test.mjs`
- `tests/skill-routing-regression.test.mjs`
- `tests/cli.test.mjs`（markdown 出力のスキル ID assert）

実装方針が決まり次第、上記を基準に回帰範囲を確定する。
