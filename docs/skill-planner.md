# Skill Planner（LLM ベースのスキル選択）の接続例

スキルプランナーは、`review-runner` に渡す `planner`（または `planner.plan`）関数として差し込むだけで動きます。LLM なしでも決定論的に動きますが、LLM を使う場合のミニマム実装例をまとめました。

## インターフェース

- 入力: `llmPlan({ skills, context })`
  - `skills`: `summarizeSkill` 済みメタデータ配列（id/name/description/phase/applyTo/inputContext/outputKind/modelHint/dependencies/tags/severity）
  - `context`: `phase` / `changedFiles` / `availableContexts`（必要なら diff 要約や PR 情報を拡張可）
- 出力: `[{ id, reason? }]`（配列順が実行順。`priority` は現状未使用）

## 最小実装例（Node + fetch）

```js
import { buildExecutionPlan } from './src/lib/review-runner.mjs';

// LLM 呼び出しラッパー（任意のプロバイダに置き換え可）
async function llmPlan({ skills, context }) {
  const prompt = [
    'You are a code-review skill planner.',
    `Phase: ${context.phase}`,
    `Changed files: ${context.changedFiles.join(', ') || 'none'}`,
    'Skills:',
    ...skills.map((s) => `- ${s.id}: ${s.name} (${s.inputContext.join('/') || 'any'})`),
    'Return JSON array of {id, reason} in execution order.',
  ].join('\n');

  const res = await fetch(process.env.LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// runner への組み込み例
const plan = await buildExecutionPlan({
  phase: 'midstream',
  changedFiles: ['src/foo.js'],
  availableContexts: ['diff', 'fullFile'],
  planner: llmPlan,
});
console.log(plan.selected.map((s) => s.metadata.id));
```

## 運用メモ

- LLM を渡さない場合（`planner` 未指定）は決定論的な並び替えで実行されます。
- LLM 呼び出しに失敗した場合も自動で決定論的順序にフォールバックし、理由が `plannerReasons` に残ります。
- API キーやエンドポイントは `.env` などに保持し、リポジトリにコミットしないでください。
- LLM レスポンスの JSON パースに失敗する場合は `try/catch` を入れて決定論的順序に戻すのがおすすめです（`planSkills` でも例外時にフォールバックします）。
