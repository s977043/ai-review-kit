// #1644 残件7: finding の `scope` を YAML / HTML / Markdown へ届ける回帰テスト。
//
// 期待値は実装から導かず、読み手が受け取るべき literal を直に書く。
// 固定する不変条件は 2 方向ある:
//   - 値を持つ finding では scope が出る（YAML の行 / HTML の chip / Markdown の印）
//   - 値を持たない finding では何も出ない（`scope: null`・空文字・空 chip を出さない）
//
// 欠損側を落とさないことが要点である。scope は fail-safe の既定値 `in-diff` を
// 持つため、実行時の finding はほぼ必ず値を持つ。値が無いのは field 導入前に
// 生成された artifact を読み直した場合であり、そこへ `scope: null` を書き足すと
// 「機械判定の結果 null だった」と読めてしまう。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatYamlOutput } from '../src/lib/output-formatters/yaml.mjs';
import { formatHtmlOutput } from '../src/lib/output-formatters/html.mjs';
import { printMarkdownReport } from '../src/cli/render.mjs';

/** printMarkdownReport の stdout を文字列で受け取る。 */
function renderMarkdown(result, phase = 'midstream') {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  try {
    printMarkdownReport(result, phase);
  } finally {
    console.log = originalLog;
  }
  return lines.join('\n');
}

const MESSAGE =
  'Finding: catch で例外が握りつぶされる Evidence: catch 内で return Impact: 障害調査が困難 Fix: ログ+再throw Severity: warning Confidence: high';

function makeFinding(overrides = {}) {
  return {
    id: 'rr-1',
    ruleId: 'logging-observability',
    file: 'src/app.js',
    line: 5,
    lineStart: 5,
    lineEnd: 5,
    title: 'catch で例外が握りつぶされる',
    message: MESSAGE,
    severity: 'major',
    confidence: 'high',
    status: 'open',
    evidence: ['catch 内で return'],
    ...overrides,
  };
}

function makeMarkdownResult(commentOverrides = {}) {
  const finding = makeFinding();
  return {
    findings: [finding],
    comments: [
      {
        skillId: finding.ruleId,
        file: finding.file,
        line: finding.lineStart,
        message: finding.message,
        ...commentOverrides,
      },
    ],
    plan: { selected: [], skipped: [] },
    changedFiles: ['src/app.js'],
    tokenEstimate: 42,
    status: 'ok',
  };
}

describe('#1644 残件7: YAML surface carries scope', () => {
  it('emits a scope row for pre-existing', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding({ scope: 'pre-existing' })],
    });
    assert.match(output, /\n {6}scope: pre-existing\n/);
  });

  it('emits a scope row for in-diff', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding({ scope: 'in-diff' })],
    });
    assert.match(output, /\n {6}scope: in-diff\n/);
  });

  it('omits the row entirely when the finding carries no scope', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding()],
    });
    assert.doesNotMatch(output, /scope:/);
  });

  it('omits the row for an explicit null scope instead of writing "scope: null"', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding({ scope: null })],
    });
    assert.doesNotMatch(output, /scope:/);
  });
});

describe('#1644 残件7: HTML surface carries scope', () => {
  it('renders a pre-existing chip next to the severity chip', () => {
    const html = formatHtmlOutput(
      { findings: [makeFinding({ scope: 'pre-existing' })], timestamp: '2026-01-01T00:00:00.000Z' },
      'midstream'
    );
    assert.match(
      html,
      /<span class="sev" style="background:#9e9e9e;margin-left:6px">pre-existing<\/span>/
    );
  });

  it('renders an in-diff chip', () => {
    const html = formatHtmlOutput(
      { findings: [makeFinding({ scope: 'in-diff' })], timestamp: '2026-01-01T00:00:00.000Z' },
      'midstream'
    );
    assert.match(
      html,
      /<span class="sev" style="background:#37474f;margin-left:6px">in-diff<\/span>/
    );
  });

  it('renders no chip at all when the finding carries no scope', () => {
    const html = formatHtmlOutput(
      { findings: [makeFinding()], timestamp: '2026-01-01T00:00:00.000Z' },
      'midstream'
    );
    assert.doesNotMatch(html, /margin-left:6px/);
    assert.doesNotMatch(html, /in-diff|pre-existing/);
  });

  it('escapes an out-of-vocabulary scope value instead of injecting markup', () => {
    const html = formatHtmlOutput(
      {
        findings: [makeFinding({ scope: '<script>alert(1)</script>' })],
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      'midstream'
    );
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});

describe('#1644 残件7: Markdown marks pre-existing only', () => {
  it('marks a pre-existing finding right after the file:line reference', () => {
    const markdown = renderMarkdown(makeMarkdownResult({ scope: 'pre-existing' }));
    assert.match(markdown, /- `src\/app\.js:5` _\(pre-existing\)_\n {2}- \*\*Finding:\*\*/);
  });

  it('adds no marker for in-diff (the default value would badge every line)', () => {
    const markdown = renderMarkdown(makeMarkdownResult({ scope: 'in-diff' }));
    assert.doesNotMatch(markdown, /_\(pre-existing\)_/);
    assert.doesNotMatch(markdown, /_\(in-diff\)_/);
    assert.match(markdown, /- `src\/app\.js:5`\n {2}- \*\*Finding:\*\*/);
  });

  it('adds no marker when the comment carries no scope', () => {
    const markdown = renderMarkdown(makeMarkdownResult());
    assert.doesNotMatch(markdown, /_\(pre-existing\)_/);
  });
});
