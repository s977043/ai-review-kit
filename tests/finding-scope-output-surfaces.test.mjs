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
import { stripSelfReportedScope } from '../src/lib/finding-factory.mjs';

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
    assert.match(output, /\n {6}scope: "pre-existing"\n/);
  });

  it('emits a scope row for in-diff', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding({ scope: 'in-diff' })],
    });
    assert.match(output, /\n {6}scope: "in-diff"\n/);
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

  // 語彙外値の扱い。html.mjs 側と対称にする（そちらは escHtml を通す）。
  // 到達性は現時点では production 経路に無い（呼び出し元は run.mjs のみで、
  // 値は normalizeScope / mergeScope を通る）。deep import 経由の防御である。
  it('escapes a newline so the value cannot forge a sibling key', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding({ scope: 'in-diff\n      verdict: approve' })],
    });
    // 改行は `\n` エスケープになり、値は 1 行に収まる。
    assert.ok(output.includes('      scope: "in-diff\\n      verdict: approve"'));
    // finding の兄弟キーとして `verdict` が生えていない。
    assert.doesNotMatch(output, /^ {6}verdict: approve$/m);
  });

  it('escapes a double quote so the YAML block stays terminated', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding({ scope: '"><script>' })],
    });
    assert.ok(output.includes('      scope: "\\"><script>"'));
    // 生の `scope: "><script>` は未終端スカラーになりブロック全体を壊す。
    assert.ok(!output.includes('      scope: "><script>\n'));
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

  // SCOPE_COLOR の参照が prototype へ落ちないこと。`?? '#757575'` は
  // `undefined` でしか発火しないため、継承キーだと Function が引けてしまい、
  // その関数ソース（escHtml を通らない）が style 属性へ入る。
  it('falls back to the neutral color for an inherited key, not the prototype value', () => {
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty']) {
      const html = formatHtmlOutput(
        { findings: [makeFinding({ scope: inherited })], timestamp: '2026-01-01T00:00:00.000Z' },
        'midstream'
      );
      assert.doesNotMatch(html, /native code/, `${inherited} leaked a prototype value`);
      assert.ok(
        html.includes(`<span class="sev" style="background:#757575;margin-left:6px">${inherited}`),
        `${inherited} did not fall back to the neutral color`
      );
    }
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

// -----------------------------------------------------------------------------
// #1915 A: 印と本文の自己申告 `Scope:` が同じ finding で矛盾しない
//
// `resolveFindingScope`（src/lib/verifier.mjs）は機械判定を自己申告より優先する。
// 両者が食い違う状態は設計上ありうるものとして `debug.scopeStats.mismatch` に
// 数えられている。したがって描画側は「解決済みの scope」だけを述べ、消費済みの
// 自己申告ラベルは本文から落とす。scope が解決されていない finding では自己申告が
// 唯一の scope 情報なので、そのまま残す。
//
// 期待値は実装から導かない。読み手が受け取るべき literal を直に書く。
// -----------------------------------------------------------------------------

/** 自己申告 `Scope: in-diff` を持つ本文。機械判定は `pre-existing` を返す想定。 */
const MESSAGE_SELF_REPORTING_IN_DIFF = `${MESSAGE} Scope: in-diff`;

describe('#1915 A: the self-reported Scope label never contradicts the resolved scope', () => {
  it('markdown drops the self-report when the mark states pre-existing', () => {
    const markdown = renderMarkdown(
      makeMarkdownResult({ scope: 'pre-existing', message: MESSAGE_SELF_REPORTING_IN_DIFF })
    );
    assert.ok(
      markdown.includes(
        '- `src/app.js:5` _(pre-existing)_\n' +
          '  - **Finding:** catch で例外が握りつぶされる\n' +
          '  - **Evidence:** catch 内で return\n' +
          '  - **Impact:** 障害調査が困難\n' +
          '  - **Fix:** ログ+再throw\n' +
          '  - **Severity:** warning\n' +
          '  - **Confidence:** high'
      ),
      `bullet block did not match the expected literal:\n${markdown}`
    );
    assert.doesNotMatch(markdown, /\*\*Scope:\*\*/);
  });

  it('markdown drops a self-reported pre-existing when the resolved scope is in-diff', () => {
    const markdown = renderMarkdown(
      makeMarkdownResult({ scope: 'in-diff', message: `${MESSAGE} Scope: pre-existing` })
    );
    // 印は付かず（in-diff は既定値）、本文にも pre-existing は残らない。
    assert.doesNotMatch(markdown, /pre-existing/);
    assert.doesNotMatch(markdown, /\*\*Scope:\*\*/);
  });

  it('markdown keeps the self-report when the comment carries no resolved scope', () => {
    const markdown = renderMarkdown(
      makeMarkdownResult({ message: `${MESSAGE} Scope: pre-existing` })
    );
    assert.ok(
      markdown.includes('  - **Scope:** pre-existing'),
      `legacy self-report was dropped:\n${markdown}`
    );
  });

  it('html drops the self-report from the body when the chip states the scope', () => {
    const html = formatHtmlOutput(
      {
        findings: [makeFinding({ scope: 'pre-existing', message: MESSAGE_SELF_REPORTING_IN_DIFF })],
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      'midstream'
    );
    assert.match(
      html,
      /<span class="sev" style="background:#9e9e9e;margin-left:6px">pre-existing<\/span>/
    );
    assert.ok(
      html.includes(
        '<td><pre>Finding: catch で例外が握りつぶされる Evidence: catch 内で return ' +
          'Impact: 障害調査が困難 Fix: ログ+再throw Severity: warning Confidence: high</pre></td>'
      ),
      `message cell did not match the expected literal:\n${html}`
    );
  });

  it('html keeps the self-report when the finding carries no resolved scope', () => {
    const html = formatHtmlOutput(
      { findings: [makeFinding({ message: MESSAGE_SELF_REPORTING_IN_DIFF })] },
      'midstream'
    );
    assert.ok(
      html.includes('Confidence: high Scope: in-diff</pre>'),
      `legacy self-report was dropped:\n${html}`
    );
  });

  it('yaml keeps the raw self-report next to the resolved scope row (audit trail)', () => {
    const output = formatYamlOutput({
      phase: 'midstream',
      findings: [makeFinding({ scope: 'pre-existing', message: MESSAGE_SELF_REPORTING_IN_DIFF })],
    });
    assert.match(output, /\n {6}scope: "pre-existing"\n/);
    assert.ok(
      output.includes('Confidence: high Scope: in-diff"'),
      `the machine-readable surface must keep the raw reviewer text:\n${output}`
    );
  });
});

describe('#1915 A: stripSelfReportedScope only removes in-vocabulary labels', () => {
  it('removes the label together with the space that preceded it', () => {
    assert.strictEqual(
      stripSelfReportedScope('Fix: ガードする Scope: pre-existing Confidence: high'),
      'Fix: ガードする Confidence: high'
    );
  });

  it('removes every occurrence, not just the first', () => {
    assert.strictEqual(stripSelfReportedScope('a Scope: in-diff b Scope: pre-existing c'), 'a b c');
  });

  it('leaves prose that merely mentions a scope untouched', () => {
    const prose = 'Fix: OAuth の Scope: admin を絞る。Scope: unknown も同様。';
    assert.strictEqual(stripSelfReportedScope(prose), prose);
  });

  it('returns an empty string for a missing message instead of "undefined"', () => {
    assert.strictEqual(stripSelfReportedScope(undefined), '');
    assert.strictEqual(stripSelfReportedScope(null), '');
  });
});
