# `--reviewers` フラグリファレンス

> **スコープ注意**: このページは `river run` の `--reviewers` フラグと検証コマンドのみを扱います。
>
> - `river run` の全フラグ（`--phase` / `--planner` / `--dry-run` / `--output` / `--max-cost` / `--debug` / `--estimate` など）は **[stable-interfaces.md](./stable-interfaces.md)** を参照してください。
> - W-check で使用する `river review exec` のフラグ（`--artifact`, `--ensemble`, `--phase`）は **[W-check ガイド](../guides/w-check.md)** および **[cli-review-exec-spec.md](./cli-review-exec-spec.md)** を参照してください。

Runner CLI を使用して、River Review のエージェントとスキルをローカルまたは CI で検証します。
軽量な Python ランナーが `schemas/output.schema.json` に従う構造化されたレビュー結果を出力します。
Python の例を実行する前に、`pip install jsonschema` で必要な依存関係をインストールしてください。

## `--reviewers` フラグ

`river run` の `--reviewers` フラグにはロール名のリスト（カンマ区切り）または特殊キーワード `auto` を指定できます。

### `auto` キーワード

`--reviewers auto` を指定すると、diff の内容を解析してレビュアーロールを自動選択します。`bug-hunter` は常に含まれ、以下のシグナルに基づいて追加ロールが加わります。

| シグナル                                                                                                                      | 追加されるロール      |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| config / schema / migration / infra ファイルが変更されている、またはリスク評価済みファイルが存在する                          | `security-scanner`    |
| test ファイルが変更されている、または app ファイルが 3 件以上ある                                                             | `test-gap`            |
| package manifest / lockfile（`package.json` / `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`）が変更されている          | `dependency-reviewer` |
| UI / コンポーネント / スタイル（`.tsx` / `.jsx` / `.css` / `.scss` / `.sass` / `.less` / `.vue` / `.svelte`）が変更されている | `frontend-reviewer`   |
| `.github/workflows/` 配下のワークフローが変更されている                                                                       | `ci-cd-reviewer`      |

シグナルが何もない場合は `bug-hunter` のみが使われます。

JSON 出力の `autoSelectedRoles` フィールドで選択されたロールを確認できます。

```json
{
  "autoSelectedRoles": ["bug-hunter", "security-scanner"]
}
```

### 大きな diff の分割と findings の重複排除

複数のロール（`auto` を含む）でレビューする場合、大きな diff は自動的にチャンクに分割され、ロール × チャンクで並列実行されます。各実行から得られた findings は、最終 ID を割り当てる前にチャンク・ロール間で重複排除されます（実装: `src/lib/reviewer-orchestrator.mjs` の `splitDiffIntoChunks` / `deduplicateFindings`）。このため、同一箇所の重複指摘は 1 件に統合されます。

## コマンド

- Agents: `npm run agents:validate` (または `node scripts/validate-agents.mjs`)
- Skills: `npm run skills:validate` (または `node scripts/validate-skills.mjs`)
- 構造化出力 (Python): `python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json`

## 終了コード

### `river run` / `src/cli.mjs`

| コード | 意味                                                               |
| ------ | ------------------------------------------------------------------ |
| `0`    | 正常終了                                                           |
| `1`    | 実行エラーまたはスキーマエラー（レビュー失敗・出力検証失敗を含む） |
| `3`    | 不明なサブコマンドまたは引数エラー                                 |

### `river review` / `river eval`（`runners/cli`）

`runners/cli` のコマンドは現時点ではすべてのエラーをコード `1` に集約します。コード `3` は発生しません。

| コード | 意味                                             |
| ------ | ------------------------------------------------ |
| `0`    | 正常終了                                         |
| `1`    | 実行エラー・スキーマエラーを含むすべての異常終了 |

### 検証スクリプト（Python）

- `0`: 検証が正常に完了した。
- `1`: スキーマチェックが通過しなかったか、スキーマエラーが発生した。

## 例

```bash
# すべてのエージェントを検証
npm run agents:validate

# すべてのスキルを検証
npm run skills:validate

# 構造化されたレビュー出力をビルド（artifacts/river-review-output.json に書き込み）
python scripts/rr_runner.py --input tests/fixtures/structured-output/sample_llm_response.json
```
