/**
 * CLI 経由で `--output yaml` / `--output html` / `--output json` / text の
 * **成果物の中身**を検査する（#1962）。
 *
 * なぜこの層なのか: `tests/output-formatters/yaml.test.mjs` と
 * `tests/output-html.test.mjs` はフォーマッタへ手組みオブジェクトを渡すユニット
 * テストで、`src/cli/commands/run.mjs` が artifact を組み立てる**配線層**を通ら
 * ない。`tests/cli-output-stream-routing.test.mjs` は CLI を通すが exit code と
 * ヘッダーの stream しか見ておらず、本体を parse しない。結果として配線層の変異
 * が全テストを素通りしていた。
 *
 * 検出力は変異注入で測ること（PR 本文に結果を転記する）。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';

import { runCliInProcess } from './helpers/cli.mjs';
import { createRepoWithSilentCatchChange } from './helpers/temp-repo.mjs';

/** ```yaml フェンスの中身だけを取り出して load する。 */
function loadYamlBlock(stdout) {
  const match = stdout.match(/```yaml\n([\s\S]*?)\n```/);
  assert.ok(match, 'stdout に ```yaml フェンスが無い');
  return yaml.load(match[1]);
}

async function runFormats(formats) {
  const { dir, cleanup } = await createRepoWithSilentCatchChange();
  const out = {};
  try {
    for (const format of formats) {
      out[format] = await runCliInProcess(['run', '.', '--dry-run', '--output', format], {
        cwd: dir,
      });
      assert.strictEqual(out[format].code, 0, `${format}: ${out[format].stderr}`);
    }
  } finally {
    await cleanup();
  }
  return out;
}

describe('CLI structured output artifacts (#1962)', () => {
  test('yaml block carries the same verdict as the JSON decision (#1170 F3)', async () => {
    const { json, yaml: yamlRun } = await runFormats(['json', 'yaml']);
    const jsonOutput = JSON.parse(json.stdout);
    const block = loadYamlBlock(yamlRun.stdout);

    assert.ok(block.review, 'yaml に review ルートが無い');
    assert.strictEqual(
      block.review.verdict,
      jsonOutput.decision,
      'yaml の verdict が JSON の decision と一致しない（#1170 F3 の契約）'
    );
  });

  test('yaml findings mirror the JSON issues one-for-one, with line numbers intact', async () => {
    const { json, yaml: yamlRun } = await runFormats(['json', 'yaml']);
    const issues = JSON.parse(json.stdout).issues;
    const findings = loadYamlBlock(yamlRun.stdout).review.findings;

    assert.ok(Array.isArray(issues) && issues.length > 0, 'fixture が finding を出していない');
    assert.strictEqual(findings.length, issues.length, 'yaml と JSON で finding 件数が違う');

    // yaml のフォーマッタは `line` を読む。配線が生の findings（`lineStart`）を
    // 渡すと、ここが undefined になって落ちる。
    for (const [i, finding] of findings.entries()) {
      assert.strictEqual(finding.severity, issues[i].severity, `findings[${i}].severity`);
      assert.strictEqual(finding.file, issues[i].file, `findings[${i}].file`);
      assert.strictEqual(finding.line, issues[i].line, `findings[${i}].line`);
      assert.strictEqual(finding.title, issues[i].title, `findings[${i}].title`);
    }
  });

  test('html decision banner matches the JSON decision (#1170 F3)', async () => {
    const { json, html } = await runFormats(['json', 'html']);
    const decision = JSON.parse(json.stdout).decision;

    // html は生の decision 文字列ではなく DECISION_CONFIG のラベルを描画する。
    // 対応表をテスト側に固定して、配線とラベル写像の両方を pin する。
    const BANNER_LABEL = {
      'auto-approve': 'Auto Approve',
      'human-review-recommended': 'Human Review Recommended',
      'human-review-required': 'Human Review Required',
    };
    const expected = BANNER_LABEL[decision];
    assert.ok(expected, `未知の decision: ${decision}（対応表の更新が要る）`);

    assert.match(html.stdout, /^<!DOCTYPE html>/i, 'html が DOCTYPE で始まっていない');
    assert.match(
      html.stdout,
      new RegExp(`class="banner"[^>]*>\\s*[^<]*${expected}`),
      `html の banner が JSON の decision (${decision} → "${expected}") と一致しない`
    );
    assert.doesNotMatch(html.stdout, /Decision: N\/A/, 'decision が html へ伝播していない');
  });

  test('json output stays 2-space indented', async () => {
    const { json } = await runFormats(['json']);
    const parsed = JSON.parse(json.stdout);
    assert.strictEqual(
      json.stdout.trimEnd(),
      JSON.stringify(parsed, null, 2),
      'JSON のインデントが 2 スペースでない'
    );
  });

  test('text output prints the plan before the comments', async () => {
    const { text } = await runFormats(['text']);
    // printPlan 固有の見出しと printComments 固有の見出しで順序を測る。
    const planAt = text.stdout.indexOf('Skip reasons summary:');
    const commentsAt = text.stdout.indexOf('Review comments:');
    assert.ok(planAt >= 0, `text 出力に計画セクションが無い:\n${text.stdout.slice(0, 400)}`);
    assert.ok(
      commentsAt >= 0,
      `text 出力にコメントセクションが無い:\n${text.stdout.slice(0, 400)}`
    );
    assert.ok(planAt < commentsAt, 'text 出力で計画がコメントより後に出ている');
  });
});
