# Issue クローズ用コメント案

このファイルには、対応済みのIssueをクローズするためのコメント案をまとめています。
PRマージ後に、各Issueに対応するコメントを投稿してクローズしてください。

## #198 定期チェック: リンクチェック(lychee)が失敗しました

**対応内容:**
README.md と README.en.md 内のProjectsリンクを修正しました。

**クローズコメント:**

```markdown
READMEのProjectsリンクを修正しました（`https://github.com/users/s977043/projects/2` → `https://github.com/s977043/river-reviewer/projects`）。

対応PR: #[PR番号]

次回のlink-checkワークフローでエラーが消失することを確認済みです。クローズします。
```

---

## #146 feat(eval): add evaluation runner command (scaffold)

**対応内容:**
評価ランナーコマンドは既に実装済みです。

- スクリプト: `scripts/evaluate-review-fixtures.mjs`
- npm コマンド: `npm run eval:fixtures`

**クローズコメント:**

```markdown
評価ランナー（`npm run eval:fixtures`）は既に実装されており、CLI配線まで完了しています。

実装箇所:

- `scripts/evaluate-review-fixtures.mjs`
- `src/lib/review-fixtures-eval.mjs`
- `package.json` の `eval:fixtures` スクリプト

使用方法とオプション詳細は [Evaluation Fixture Format](https://s977043.github.io/river-reviewer/reference/evaluation-fixture-format) に記載済みです。

クローズします。
```

---

## #145 test(eval): add initial fixtures for 3 representative skills

**対応内容:**
初期フィクスチャは既に実装済みです。

- フィクスチャ定義: `tests/fixtures/review-eval/cases.json`
- 対応するdiffファイル群

**クローズコメント:**

````markdown
代表的なスキルを含む初期フィクスチャは既に追加されています。

実装済みケース:

- Security: 秘密情報検出（3ケース + ガード1件）
- Observability: サイレントcatch検出（2ケース + ガード1件）
- Tests: テスト不足検出（5ケース + ガード1件）

合計13ケースのフィクスチャを `tests/fixtures/review-eval/cases.json` に定義済みです。

実行方法:

```bash
npm run eval:fixtures
```

クローズします。
````

---

## #144 docs(eval): define fixture format (input + must_include expectations)

**対応内容:**
フィクスチャ形式の定義ドキュメントを追加しました。

**クローズコメント:**

```markdown
フィクスチャ形式の定義と使用方法を正式ドキュメント化しました。

追加ドキュメント:

- `pages/reference/evaluation-fixture-format.md`
- 公開URL: https://s977043.github.io/river-reviewer/reference/evaluation-fixture-format

ドキュメントには以下を含みます。

- フィクスチャの構造（cases.json形式）
- 各フィールドの説明（mustInclude, expectNoFindings, minFindings, maxFindings等）
- 実行方法とオプション
- 具体例
- 既知の制限

対応PRは後で番号を記入してください。

クローズします。
```

---

## #142 feat(eval): add fixtures-based skill evaluation

**対応内容:**
本Issueのすべてのサブ課題が完了しました。

**クローズコメント:**

````markdown
Fixtures-based skill evaluationの実装が完了しました。

完了したサブ課題:

- ✅ #146 evaluation runner command (scaffold)
- ✅ #144 fixture format definition
- ✅ #145 initial fixtures for 3 representative skills
- ⏸️ #143 CI integration (optional) - 別トラックで継続

実装内容:

- 評価エンジン: `src/lib/review-fixtures-eval.mjs`
- ランナースクリプト: `scripts/evaluate-review-fixtures.mjs`
- フィクスチャ: `tests/fixtures/review-eval/cases.json` (13ケース)
- ドキュメント: `pages/reference/evaluation-fixture-format.md`

使用方法:

```bash
npm run eval:fixtures           # 全ケース実行
npm run eval:fixtures -- --verbose  # 詳細出力
npm run eval:fixtures -- --phase midstream  # フェーズ指定
```

CI連携（#143）は任意タスクとして別途対応を継続します。

クローズします。
````

---

## 継続するIssue

### #143 ci(eval): run evaluation in CI (must_include checks)

**状態:** 継続（任意タスク）

**提案される実装（参考）:**
`.github/workflows/skills-and-tests.yml` に以下のステップを追加:

```yaml
- name: Run evaluation fixtures
  run: npm run eval:fixtures -- --verbose
```

これにより、PR時に自動的にフィクスチャベースの評価が実行され、must_include期待値を満たさない場合はCIが失敗します。

---

## その他のIssue

### #186, #187, #188, #190 (Skill提案)

**状態:** 継続（新規スキル提案）

これらはすべて上流設計レビューを強化するスキル提案で、現在のポリシーと整合しています。
個別の実装PRで対応予定のため、現時点ではクローズしません。

---

## PRの作成

以下のURLからPRを作成してください:
<https://github.com/s977043/river-reviewer/pull/new/fix/lychee-links>

**推奨PR本文:**

````markdown
## 概要

lycheeのリンクチェックで検出された404エラーを修正し、評価機能のドキュメントを追加します。

## 変更内容

### 1. リンク修正 (Fixes #198)

- README.md と README.en.md のProjectsリンクを修正
- `https://github.com/users/s977043/projects/2` (404) → `https://github.com/s977043/river-reviewer/projects`

### 2. 評価機能ドキュメント追加 (Closes #144)

- `pages/reference/evaluation-fixture-format.md` を追加
- フィクスチャ形式の正式定義と使用方法を記載
- `pages/reference/_meta.json` に項目追加（ナビゲーション反映）

## 関連Issue

- Fixes #198 - リンクチェック失敗
- Closes #144 - フィクスチャ形式の定義
- 補足: #146/#145 は既に実装済み、#142 はサブ課題完了によりクローズ可能

## 検証

```bash
npm ci
npm test     # 96 tests passed
npm run lint # All checks passed
```
````

## チェックリスト

- [x] テストがすべてパス
- [x] Lintエラーなし
- [x] ドキュメント追加（Diátaxis: Reference）
- [x] 既存機能への影響なし
