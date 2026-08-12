# S1 Fixture Convention（skill 品質の最小規約）

> 出典: 2026-05-21〜25 retrospective。skill-pack-design.md §2 原則 3 が参照する規約の明文化です。

## 規約

skill を「テスト済みナレッジ」として扱うための最小条件を S1 と呼びます。

- **good fixture（happy-path）**: skill が検出すべき入力例。`*-should-detect` または `<NN>-happy.md` 形式で配置する
- **bad fixture（guard）**: skill が黙るべき入力例（false-positive canary）。`*-should-not-detect` または `<NN>-guard.md` 形式で配置する
- **golden output**: 期待される finding の要点（must_include トークン）。`npm run eval:fixtures` が照合する

配置場所は各 skill ディレクトリ配下の `fixtures/` または `eval/` とします。

## pack tier との関係

- `tier: official` の pack は、所属する全 skill が S1 を満たすことが機械条件である（`skills:validate` の validatePacks が fixtures/ または eval/ の存在を検査する）
- 内容の十分性（fixture がトリビアルでないか）は maintainer review で確認する（機械判定は必要条件にとどめる）

## 検証コマンド

```bash
npm run skills:validate   # pack 構造 + official tier の機械条件
npm run eval:fixtures     # fixture の回帰実行
```

## 未整備 skill への横展開手順

fixtures と eval のどちらも持たない skill へ、S1 を後追いで足すときの手順です。#1806 のパイロット 5 件（`api-design` / `failure-modes-observability` / `architecture-boundaries` / `api-versioning-compat` / `adr-decision-quality`）はこの順で作業しています。

### 1. 対象を数え、優先順を機械的に決める

未整備 skill の一覧と件数は次で取得する。

```bash
# 未整備 skill の一覧（fixtures/ も eval/ も無いもの）
for d in skills/*/*/; do [ -d "$d/fixtures" ] || [ -d "$d/eval" ] || echo "$d"; done

# fixtures または eval を持つ skill の件数
git ls-files 'skills/**/fixtures/*' 'skills/**/eval/*' | sed -E 's#/(fixtures|eval)/.*##' | sort -u | wc -l
```

優先順は次の 2 段で決める。恣意的な選定を避けるため、両方とも実測値で並べる。

- 第 1 基準: `scripts/validate-skills.mjs` の `GRANDFATHERED_WITHOUT_EVAL` に載っている skill を先に扱う。この集合は `recommended: true` でありながら S1 を免除されている skill であり、fixtures を足すと免除を 1 件外せる
- 第 2 基準: `tests/fixtures/planner-dataset/cases.json` の `expectedAny` / `expectedTop1` に登場する回数が多い順。planner が実データで選ぶ skill ほど、fixture の投資対効果が高い
- 同数で並んだ場合は `applyTo` のパターン数が少ない skill を先に選ぶ。対象ファイル種別が 1 つに絞れるほど fixture の入力を決定論的に書ける

なお `src/` から skill id を直接参照している箇所は無い（`git grep -l <id> src/` は 0 件）。実運用の指標には registry と planner dataset を使うこと。

### 2. positive / negative を 1 対で置く

1 skill につき最低 2 件を置く。片方だけでは、検出漏れか過検出かのどちらかが測れない。

- positive（`01-<topic>-should-detect.md`）: SKILL.md の Rule / Checklist に照らして必ず検出されるべき入力
- negative（`02-<topic>-should-not-detect.md`）: 同じ Pre-execution Gate を通過したうえで、False-positive guards により黙るべき入力

negative fixture は「ゲート不成立で対象外」だけにしない。ゲートを通過したうえで抑制条件が効くケースを 1 件は含めること。ゲート不成立だけの fixture は、抑制条件が壊れても緑のままになる。

### 3. 期待値は SKILL.md から決定論的に導く

期待値は LLM を実行して得た出力ではなく、SKILL.md の Rule / Checklist / False-positive guards から導ける内容だけを書く。CI には API キーが無く、LLM 実行は走らないため、実行結果に依存する期待値は検証されないまま残る。

各 fixture の末尾に `<!-- expected: -->` ブロックを置く。ブロックの中身は YAML で、`scripts/validate-skills.mjs` の `validateFixtureDrift()` がパースする。

```markdown
<!-- expected:
findings:
  - severity: major
    reason: <なぜ検出されるべきか>
    anchor: <file>:<line>
-->
```

negative fixture は `findings: []` と `reason` を書く。`findings: []` の fixture が 1 件でもあると、その skill の Check 未参照警告が抑止される（全 Check を暗黙に通過するとみなされるため）。

`## Check N` 形式の見出し（英語タイトル付き）を持つ skill では、`findings[].check` に整数を書ける。その場合は 2 つの機械条件が追加でかかる。

- 参照した Check 番号が SKILL.md に実在すること（dangling expectation はエラー）
- Check 見出しが 2 つ以上あるとき、frontmatter の `description` が全 Check を列挙していること

見出しを持たない skill（上記パイロット 5 件はすべてこの型）では `check:` を書かない。書かないことで description 列挙ゲートは発火せず、frontmatter を触らずに済む。frontmatter の `inputContext` / `dependencies` / `tags` を変更すると `tests/planner-dataset-eval.test.mjs` が落ちるため、fixtures 追加だけの PR では frontmatter を触らないこと。

### 4. 免除を外す

対象 skill が `GRANDFATHERED_WITHOUT_EVAL` に載っている場合、fixtures を足したのと同じコミットでその id を集合から削除する。削除しないと、置かれた fixtures は機械的に検証されない状態のまま残る。

### 5. 実測で確認する

`npm run skills:validate` の出力にある次の 2 行が、fixtures が実際に検証対象へ入ったことの証跡となる。作業前後の値を控えて差分を報告する。

- `recommended eval coverage: N/M ... (incl. K grandfathered)` の K が、外した件数だけ減る
- `fixture drift: N skill(s) with expected blocks consistent` の N が、fixtures を足した skill 数だけ増える

パイロットでは grandfathered が 30 から 25 へ、expected blocks を持つ skill が 8 から 13 へ動いている。
