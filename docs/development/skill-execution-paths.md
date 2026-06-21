# Skill 実行経路と Gate 非強制の差（#1232）

River Review には skill を実行する経路が 2 つあります。両者は skill メタデータのフィルタ範囲と diff の渡し方が異なります。skill 作者はこの差を理解したうえで Gate を設計する必要があります。

## 2 つの実行経路

### 1. deterministic plan 経路

`river review plan` および GitHub Action 経路で使われます。`runners/core/review-runner.mjs` の `selectSkills` / `evaluateSkill` が skill メタデータを機械的にフィルタします。

判定対象は次のとおりです。

- `applyTo`—変更ファイルが glob にマッチするか（`matchesApplyTo`）
- `phase`—対象フェーズと一致するか（`matchesPhase`）
- `inputContext`—必要なコンテキストが `availableContexts` に揃っているか（`missingInputContexts`）
- `dependencies`—必要な依存が `availableDependencies` に揃っているか（`missingDependencies`）

`inputContext` か `dependencies` が欠けた skill は `evaluateSkill` で `skipped` に振り分けられ、実行されません。Gate の一部はコードで決定論的に強制されます。

### 2. midstream dispatcher 経路

`src/core/skill-dispatcher.mjs` の `SkillDispatcher.run()` が使う経路です。フィルタは次の 3 つに限られます。

- `files`（= `applyTo`）—変更ファイルが glob にマッチするか
- `phase`—対象フェーズと一致するか
- `exclude`—除外パターンにマッチするか

この経路は `inputContext` / `dependencies` / SKILL.md の Pre-execution Gate を**コードで強制しません**。これらは `buildSystemPrompt` が組み立てる LLM プロンプト本文で*指示*されるのみです。さらに diff を**ファイル単位**で渡します（`getFileDiff(file)` を `reviewFiles` ごとにループ）。

## 帰結と skill 作者への要請

dispatcher 経路では、各 skill の Gate と False-positive guard の判定が LLM 任せになります。リポジトリ全体を要する判定を断片だけで行わせるため、False-positive のリスクが生じます。

たとえば次のような判定はファイル単位の diff だけでは正しく下せません。

- DESIGN.md など別ファイルの有無に依存する Gate
- 別ファイルに置かれた stories やテストの存在確認
- 複数ファイルにまたがる整合性チェック

dispatcher 経路では `inputContext` を宣言しても実行はブロックされず、diff も 1 ファイルずつしか渡りません。したがって skill 作者は、Gate を「skill メタデータがコードで止めてくれる前提」で書いてはいけません。Gate と抑制条件を **LLM への明確な指示** として SKILL.md 本文に書き、断片情報での誤検知を抑える文面にする必要があります。

## 参照箇所

行番号は変動するため、パスと関数名で示します。

| 経路                 | パス                             | 関数                                                                                                                          |
| -------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| deterministic plan   | `runners/core/review-runner.mjs` | `selectSkills` / `evaluateSkill`（内部で `matchesApplyTo` / `matchesPhase` / `missingInputContexts` / `missingDependencies`） |
| midstream dispatcher | `src/core/skill-dispatcher.mjs`  | `SkillDispatcher.run()`（`files` / `phase` / `exclude` のフィルタと `getFileDiff` のファイル単位ループ）                      |

## 出典

- #1232（skill 実行経路の Gate 非強制を文書化）
