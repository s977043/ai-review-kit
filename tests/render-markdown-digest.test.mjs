// #1713: markdown レポートの「人間向けサマリー先頭固定 + 段階的開示」の回帰テスト。
//
// Slice 1 (`src/cli/render.mjs`): 判定・件数・スコアを先頭 1 行に固定し、
// critical / major を常時展開、minor / info と実行ログを `<details>` に畳む。
// Slice 2: `teamLeadReport`（`--reviewers` 実行時のみ）の markdown 昇格。
//
// ここで機械的に固定する不変条件:
//   - 指摘 0 件時の初期表示行数（`<details>` を畳んだ状態で見える行）が 10 行以下
//   - critical / major は `<details>` の外、minor / info は `<details>` の中
//   - 畳んだ指摘は全文が残る（削除・打ち切りをしない）
//   - `<summary>` は必ず件数を持ち、直後に空行がある（GitHub の描画条件）
//   - json / yaml / html の成果物はバイト単位で不変
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { formatJsonOutput, printMarkdownReport } from '../src/cli/render.mjs';
import { formatYamlOutput } from '../src/lib/output-formatters/yaml.mjs';
import { formatHtmlOutput } from '../src/lib/output-formatters/html.mjs';

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

/**
 * `<details>` をすべて畳んだ状態で読み手に見える行を返す。
 * 空行と `<details>` / `</details>` タグ自体は何も描画しないので数えず、
 * 折りたたみブロックからは（最上位の）`<summary>` の 1 行だけを数える。
 */
function initiallyVisibleLines(markdown) {
  const visible = [];
  let depth = 0;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('<details')) {
      depth++;
      continue;
    }
    if (line.startsWith('</details>')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) {
      if (depth === 1 && line.startsWith('<summary>')) visible.push(line);
      continue;
    }
    if (line === '') continue;
    visible.push(line);
  }
  return visible;
}

/** `<details>` ブロックの中身（`<summary>` 行を除く）だけを返す。 */
function collapsedBody(markdown) {
  const body = [];
  let depth = 0;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('<details')) {
      depth++;
      continue;
    }
    if (line.startsWith('</details>')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0 && !line.startsWith('<summary>')) body.push(raw);
  }
  return body.join('\n');
}

/** `<details>` の外に残っている本文（常時展開部分）。 */
function expandedBody(markdown) {
  const body = [];
  let depth = 0;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('<details')) {
      depth++;
      continue;
    }
    if (line.startsWith('</details>')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) body.push(raw);
  }
  return body.join('\n');
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function makeFinding(overrides = {}) {
  const finding = {
    id: 'rr-1',
    ruleId: 'logging-observability',
    file: 'src/app.js',
    lineStart: 5,
    lineEnd: 5,
    title: 'catch で例外が握りつぶされる',
    severity: 'major',
    confidence: 'high',
    status: 'open',
    evidence: ['catch 内で return'],
    ...overrides,
  };
  // review-engine.mjs は message の `Finding:` ラベルから title を作るので、
  // fixture でも title を message に含めて実データの関係を保つ。
  finding.message =
    overrides.message ??
    `Finding: ${finding.title} Evidence: catch 内で return Impact: 障害調査が困難 Fix: ログ+再throw Severity: warning Confidence: high`;
  return finding;
}

/** finding と 1:1 対応する comment（review-engine.mjs の構築規則に合わせる）。 */
function commentFor(finding) {
  return {
    skillId: finding.ruleId,
    file: finding.file,
    line: finding.lineStart,
    message: finding.message,
  };
}

function makeResult({ findings = [], suppressed = [], plan, teamLeadReport = null } = {}) {
  return {
    findings,
    comments: findings.map(commentFor),
    classified: suppressed.length ? { suppressed } : undefined,
    plan: plan ?? { selected: [], skipped: [] },
    changedFiles: ['src/app.js'],
    tokenEstimate: 42,
    teamLeadReport,
  };
}

// -----------------------------------------------------------------------------
// Slice 1: サマリー先頭固定 + 段階的開示
// -----------------------------------------------------------------------------

describe('#1713 Slice 1: markdown headline and progressive disclosure', () => {
  it('keeps the initial view of a zero-finding run to 10 lines or fewer', () => {
    const plan = {
      selected: Array.from({ length: 15 }, (_, i) => ({ id: `skill-${i}` })),
      skipped: Array.from({ length: 113 }, (_, i) => ({
        skill: { id: `skipped-${i}` },
        reasons: ['dry-run: LLM必須スキル'],
      })),
    };
    const markdown = renderMarkdown(makeResult({ plan }));
    const visible = initiallyVisibleLines(markdown);

    assert.ok(
      visible.length <= 10,
      `expected <= 10 initially visible lines, got ${visible.length}:\n${visible.join('\n')}`
    );
    // 実行ログ（113 行のスキップ一覧）は初期表示に出ない。
    assert.doesNotMatch(expandedBody(markdown), /skipped-0/);
    assert.match(collapsedBody(markdown), /skipped-112/);
  });

  it('puts the verdict, the finding count and the score on the first content line', () => {
    const markdown = renderMarkdown(makeResult());
    const visible = initiallyVisibleLines(markdown);

    assert.strictEqual(visible[0], '<!-- river-review -->');
    assert.strictEqual(visible[1], '## River Review');
    assert.match(visible[2], /^\*\*判定: /);
    assert.match(visible[2], /指摘 0 件/);
    assert.match(visible[2], /スコア \d+\/100/);
    assert.match(visible[2], /フェーズ `midstream`/);
  });

  it('leaves critical / major findings outside <details> and folds minor / info in', () => {
    const findings = [
      makeFinding({ id: 'rr-1', severity: 'critical', file: 'src/a.js', title: 'クリティカル' }),
      makeFinding({ id: 'rr-2', severity: 'major', file: 'src/b.js', title: 'メジャー' }),
      makeFinding({ id: 'rr-3', severity: 'minor', file: 'src/c.js', title: 'マイナー' }),
      makeFinding({ id: 'rr-4', severity: 'info', file: 'src/d.js', title: 'インフォ' }),
    ];
    const markdown = renderMarkdown(makeResult({ findings }));
    const expanded = expandedBody(markdown);
    const collapsed = collapsedBody(markdown);

    assert.match(expanded, /### 要対応 \(2 件: 🔴 1 \/ 🟠 1\)/);
    assert.match(expanded, /src\/a\.js:5/);
    assert.match(expanded, /src\/b\.js:5/);
    assert.doesNotMatch(expanded, /src\/c\.js:5/);
    assert.doesNotMatch(expanded, /src\/d\.js:5/);

    assert.match(markdown, /<summary>軽微・参考の指摘 \(2 件: 🟡 1 \/ ℹ️ 1\)<\/summary>/);
    assert.match(collapsed, /src\/c\.js:5/);
    assert.match(collapsed, /src\/d\.js:5/);
  });

  it('keeps the folded findings complete — no deletion and no truncation', () => {
    const findings = [
      makeFinding({ id: 'rr-1', severity: 'minor', title: 'マイナー' }),
      makeFinding({ id: 'rr-2', severity: 'info', file: 'src/d.js', title: 'インフォ' }),
    ];
    const markdown = renderMarkdown(makeResult({ findings }));
    const collapsed = collapsedBody(markdown);

    for (const label of ['Finding', 'Evidence', 'Impact', 'Fix', 'Severity', 'Confidence']) {
      assert.strictEqual(
        countOccurrences(collapsed, `- **${label}:**`),
        2,
        `${label} must survive folding for both findings`
      );
    }
    assert.doesNotMatch(markdown, /\.\.\.$/m, 'no truncation marker may appear');
  });

  it('gives every <summary> a count and a blank line right after it', () => {
    const findings = [
      makeFinding({ id: 'rr-1', severity: 'critical' }),
      makeFinding({ id: 'rr-2', severity: 'minor', file: 'src/c.js' }),
    ];
    const markdown = renderMarkdown(
      makeResult({ findings, suppressed: [{ suppressReason: 'x' }] })
    );
    const lines = markdown.split('\n');

    const summaryIndexes = lines
      .map((line, i) => (line.trim().startsWith('<summary>') ? i : -1))
      .filter((i) => i >= 0);
    assert.ok(summaryIndexes.length >= 3, 'expected the collapsible sections to exist');

    for (const i of summaryIndexes) {
      assert.match(lines[i], /\d/, `<summary> must carry a count: ${lines[i]}`);
      // GitHub renders markdown inside <details> only when a blank line
      // separates it from </summary>.
      assert.strictEqual(
        lines[i + 1],
        '',
        `<summary> must be followed by a blank line: ${lines[i]}`
      );
    }
  });

  it('reports the suppressed count once (headline) and its reasons once (details)', () => {
    const suppressed = [
      { suppressReason: 'insufficient_evidence' },
      { suppressReason: 'insufficient_evidence' },
    ];
    const markdown = renderMarkdown(makeResult({ findings: [makeFinding()], suppressed }));

    assert.strictEqual(countOccurrences(markdown, '抑制 2 件'), 1);
    assert.strictEqual(countOccurrences(markdown, '抑制済み: 2 件'), 1);
    // 旧実装の重複表示（末尾の blockquote）は消えている。
    assert.doesNotMatch(markdown, /件の指摘を抑制しました/);
  });

  it('cannot be broken out of a <details> block by finding text', () => {
    const finding = makeFinding({
      severity: 'minor',
      message: 'Finding: </details> injected Severity: nit Confidence: high',
    });
    const markdown = renderMarkdown(makeResult({ findings: [finding] }));

    // `<` はエンティティ化されるので閉じタグとして解釈されない。文字列自体は
    // 消さず、読み手には `</details>` のまま見える。
    assert.match(collapsedBody(markdown), /&lt;\/details> injected/);
    assert.strictEqual(
      countOccurrences(markdown, '\n</details>'),
      countOccurrences(markdown, '<details>'),
      'details tags must stay balanced'
    );
  });

  it('treats a comment with no matching finding as major (fail-safe: stays expanded)', () => {
    const result = makeResult();
    result.comments = [
      { skillId: 'orphan', file: 'src/x.js', line: 1, message: 'Finding: orphan' },
    ];
    const markdown = renderMarkdown(result);

    assert.match(expandedBody(markdown), /### 要対応 \(1 件: 🟠 1\)/);
    assert.match(expandedBody(markdown), /src\/x\.js:1/);
  });
});

// -----------------------------------------------------------------------------
// Slice 1 制約: json / yaml / html はバイト単位で不変
// -----------------------------------------------------------------------------

describe('#1713 Slice 1: machine-readable surfaces stay byte-identical', () => {
  // 固定入力に対する成果物のハッシュ。markdown の段階的開示は
  // json / yaml / html に一切影響してはならない（#1713 制約）。
  // 期待値は変更前（origin/main）のコードで実測して固定した。
  const FIXED_RESULT = {
    findings: [
      {
        id: 'rr-1',
        ruleId: 'logging-observability',
        reviewer: 'logging-observability',
        file: 'src/app.js',
        lineStart: 5,
        lineEnd: 5,
        title: 'catch で例外が握りつぶされる',
        message: 'Finding: catch で例外が握りつぶされる Severity: warning Confidence: high',
        severity: 'major',
        confidence: 'high',
        status: 'open',
        evidence: ['catch 内で return'],
        suggestion: 'ログ+再throw',
      },
    ],
    plan: { selected: [], skipped: [] },
    changedFiles: ['src/app.js'],
    tokenEstimate: 42,
    status: 'ok',
  };

  function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  it('formatJsonOutput emits the same bytes', () => {
    const json = JSON.stringify(formatJsonOutput(FIXED_RESULT, 'midstream'), null, 2);
    assert.strictEqual(
      sha256(json),
      'b8dc4c3fd66d9b3c220eab7bcebbfd0e8eaea1556a35d002ab4199c69d418431',
      `JSON output changed (${Buffer.byteLength(json)} bytes). This surface is governed by schemas/output.schema.json — only update this pin for an intentional, additive schema change.\n${json}`
    );
  });

  it('formatYamlOutput emits the same bytes', () => {
    const jsonOutput = formatJsonOutput(FIXED_RESULT, 'midstream');
    const yaml = formatYamlOutput({
      phase: 'midstream',
      timestamp: '2026-01-01T00:00:00.000Z',
      findings: jsonOutput.issues,
      plan: FIXED_RESULT.plan,
      ...(jsonOutput.decision !== undefined ? { decision: jsonOutput.decision } : {}),
    });
    assert.strictEqual(
      sha256(yaml),
      '837d8a65630c7b03ebf23cd6c35962b1aaf6f9d76e563d172a26dfb7510e2be7',
      `YAML output changed (${Buffer.byteLength(yaml)} bytes).\n${yaml}`
    );
  });

  it('formatHtmlOutput emits the same bytes', () => {
    const jsonOutput = formatJsonOutput(FIXED_RESULT, 'midstream');
    const html = formatHtmlOutput(
      {
        findings: FIXED_RESULT.findings,
        plan: FIXED_RESULT.plan,
        timestamp: '2026-01-01T00:00:00.000Z',
        ...(jsonOutput.decision !== undefined ? { decision: jsonOutput.decision } : {}),
      },
      'midstream'
    );
    assert.strictEqual(
      sha256(html),
      '673b6dfc163db241712b7e50c5bd5c6555229bd114f2dcbd2363eabd342525fd',
      `HTML output changed (${Buffer.byteLength(html)} bytes).\n${html}`
    );
  });
});

// -----------------------------------------------------------------------------
// Slice 2: teamLeadReport の markdown 昇格
// -----------------------------------------------------------------------------

describe('#1713 Slice 2: teamLeadReport in markdown', () => {
  const findings = [
    makeFinding({ id: 'rr-1', severity: 'critical', title: '認可チェックが無い' }),
    makeFinding({ id: 'rr-2', severity: 'minor', file: 'src/c.js', title: '命名が不揃い' }),
  ];

  it('produces output identical to Slice 1 when teamLeadReport is null', () => {
    const withoutReport = renderMarkdown(makeResult({ findings, teamLeadReport: null }));
    const withoutField = renderMarkdown(makeResult({ findings }));
    assert.strictEqual(withoutReport, withoutField);
    assert.doesNotMatch(withoutReport, /優先確認の指摘/);
    assert.doesNotMatch(withoutReport, /未実行のレビュー観点/);
    assert.doesNotMatch(withoutReport, /合意度/);
  });

  it('renders top3 as one-line pointers, consensus badges and blind spots', () => {
    const teamLeadReport = {
      top3Findings: [
        { ...findings[0], consensusLevel: 'consensus' },
        { ...findings[1], consensusLevel: 'multi' },
      ],
      blindSpots: [{ role: 'security-reviewer', label: 'Security Reviewer' }],
      consensusSummary: { consensus: 1, multi: 1, single: 0, total: 2 },
    };
    const markdown = renderMarkdown(makeResult({ findings, teamLeadReport }));

    assert.match(markdown, /### 優先確認の指摘 \(2 件\)/);
    assert.match(markdown, /- 🔴 ★★★ \*\*認可チェックが無い\*\* \(`src\/app\.js:5`\)/);
    assert.match(markdown, /- 🟡 ★★ \*\*命名が不揃い\*\* \(`src\/c\.js:5`\)/);
    assert.match(markdown, /_合意度: ★★★ 合意 1 \/ ★★ 複数 1 \/ ★ 単独 0（計 2 件）_/);
    assert.match(markdown, /_未実行のレビュー観点 \(1\): Security Reviewer_/);
  });

  it('omits the blind-spot line when blindSpots is empty', () => {
    const teamLeadReport = {
      top3Findings: [],
      blindSpots: [],
      consensusSummary: { consensus: 0, multi: 0, single: 2, total: 2 },
    };
    const markdown = renderMarkdown(makeResult({ findings, teamLeadReport }));

    assert.doesNotMatch(markdown, /未実行のレビュー観点/);
    assert.doesNotMatch(markdown, /優先確認の指摘/);
    assert.match(markdown, /_合意度: /);
  });

  it('does not duplicate a top3 finding body — the digest is a pointer only', () => {
    const teamLeadReport = {
      top3Findings: [{ ...findings[0], consensusLevel: 'consensus' }],
      blindSpots: [],
      consensusSummary: { consensus: 1, multi: 0, single: 1, total: 2 },
    };
    const markdown = renderMarkdown(makeResult({ findings, teamLeadReport }));

    // 指摘の全文（Evidence 以下）は 要対応 / 軽微 節にそれぞれ 1 度だけ出る。
    // top3 のポインタ行には本文が無いので、finding 2 件で 2 回のまま増えない。
    assert.strictEqual(countOccurrences(markdown, '- **Evidence:**'), 2);
    // タイトルと位置は「ポインタ行」と「本文」の 2 箇所に出る（それがポインタの役目）。
    assert.strictEqual(countOccurrences(markdown, '認可チェックが無い'), 2);
    assert.strictEqual(countOccurrences(markdown, '`src/app.js:5`'), 2);
  });

  it('keeps the digest above the findings sections', () => {
    const teamLeadReport = {
      top3Findings: [{ ...findings[0], consensusLevel: 'consensus' }],
      blindSpots: [{ role: 'security-reviewer', label: 'Security Reviewer' }],
      consensusSummary: { consensus: 1, multi: 0, single: 1, total: 2 },
    };
    const markdown = renderMarkdown(makeResult({ findings, teamLeadReport }));

    assert.ok(markdown.indexOf('### 優先確認の指摘') < markdown.indexOf('### 要対応'));
  });
});
