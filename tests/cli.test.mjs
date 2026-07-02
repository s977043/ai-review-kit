// tests/cli.test.mjs
//
// river CLI の end-to-end テスト。
// 通常は runCliInProcess() で in-process 実行し、subprocess 経由が必要な
// テスト（process.exitCode の厳密検証）だけ runCliAsSubprocess() を使う。
//
// グルーピング:
//   - river run - dry-run outputs
//   - river run - markdown output
//   - river run - guards & error paths
//   - river doctor
//   - river skills subcommands
//
// 重複していた createRepoWithChange / runCli / runGit は
// tests/helpers/ に統合済み。

import assert from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test, { describe } from 'node:test';

import { runCliInProcess } from './helpers/cli.mjs';
import {
  createTempGitRepo,
  createRepoWithSilentCatchChange,
  runGit,
} from './helpers/temp-repo.mjs';
import { createTempDir, cleanupTempDirAsync } from './helpers/temp-dir.mjs';

// -----------------------------------------------------------------------------
// river run - dry-run outputs
// -----------------------------------------------------------------------------

describe('river run - dry-run outputs', () => {
  test('emits review comments in dry-run mode', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--debug'], { cwd: dir });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /River Review/);
    assert.match(result.stdout, /Review comments/);
    assert.match(result.stdout, /src\/app.js:/);
    assert.match(result.stdout, /LLM:/);
    assert.match(result.stdout, /Changed files/);
  });

  test('falls back gracefully without API key', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--debug'], { cwd: dir });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /River Review/);
    assert.match(
      result.stdout,
      /LLM: LLM API key \(ANTHROPIC_API_KEY \/ OPENAI_API_KEY \/ GOOGLE_API_KEY\) not set/i
    );
    assert.match(result.stdout, /Planner: off/i);
    assert.match(result.stdout, /Review comments/);
  });

  test('reports planner skip reason when requested without API key', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--planner', 'order', '--debug'], {
      cwd: dir,
    });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Planner: order skipped/i);
    assert.match(result.stdout, /OPENAI_API_KEY/i);
  });

  test('injects project rules into prompt when present', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const rulesDir = join(dir, '.river');
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, 'rules.md'), '- Use App Router\n- Prefer server components');

    const result = await runCliInProcess(['run', '.', '--dry-run', '--debug'], { cwd: dir });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Project rules: present/);
    assert.match(result.stdout, /Project-specific review rules/i);
  });

  test('reports when there are no changes', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    await runGit(['add', '.'], dir);
    await runGit(['commit', '-m', 'apply change'], dir);

    const result = await runCliInProcess(['run', '.'], { cwd: dir });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /No changes to review/);
  });
});

// -----------------------------------------------------------------------------
// river run - markdown output
// -----------------------------------------------------------------------------

describe('river run - markdown output', () => {
  test('supports markdown output for PR comments', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'markdown'], {
      cwd: dir,
    });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /^<!-- river-review -->/);
    assert.match(result.stdout, /## River Review/);
    assert.match(result.stdout, /### 指摘/);
    // skill id はサニタイズでハイフンがエスケープされる
    assert.match(result.stdout, /#### 🔍 logging\\-observability/);
    assert.doesNotMatch(result.stdout, /--- diff preview ---/);
    assert.match(result.stderr, /River Review \(local\)/);
  });

  test('writes debug output to stderr when markdown output is selected', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(
      ['run', '.', '--dry-run', '--output', 'markdown', '--debug'],
      { cwd: dir }
    );
    assert.strictEqual(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /--- diff preview ---/);
    assert.match(result.stderr, /--- diff preview ---/);
  });
});

// -----------------------------------------------------------------------------
// river run - guards & error paths
// -----------------------------------------------------------------------------

describe('river run - guards & error paths', () => {
  test('skips when PR labels match exclude list', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const configPath = join(dir, '.river-review.json');
    writeFileSync(
      configPath,
      JSON.stringify({ exclude: { prLabelsToIgnore: ['skip-review'] } }, null, 2),
      'utf8'
    );

    const result = await runCliInProcess(['run', '.'], {
      cwd: dir,
      env: { RIVER_PR_LABELS: 'skip-review' },
    });

    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Review skipped: PR labels matched exclude patterns/);
  });

  test('supports cost estimation only', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--estimate'], { cwd: dir });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /Cost Estimate/);
  });

  test('aborts when max-cost is exceeded', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--max-cost', '0.0001'], { cwd: dir });
    assert.notStrictEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /exceeds max-cost/i);
  });

  test('rejects negative max-cost value', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--max-cost', '-1'], { cwd: dir });
    assert.strictEqual(result.code, 0);
    assert.match(result.stderr, /requires a non-negative numeric value/i);
  });

  test('skips markdown-only changes after optimization', async (t) => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'river-cli-md-',
      initialFiles: { 'README.md': '# first\n' },
      changedFiles: { 'README.md': '# second\n' },
    });
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run'], { cwd: dir });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /No changes to review/);
  });

  test('fails gracefully outside git repos', async (t) => {
    const dir = createTempDir({ prefix: 'river-cli-empty-' });
    t.after(() => cleanupTempDirAsync(dir));
    mkdirSync(resolve(dir, 'nested'));

    const result = await runCliInProcess(['run', '.'], { cwd: dir });
    assert.notStrictEqual(result.code, 0);
    assert.match(result.stderr, /Not a git repository/);
  });
});

// -----------------------------------------------------------------------------
// river doctor
// -----------------------------------------------------------------------------

describe('river doctor', () => {
  test('reports basic setup status', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['doctor', '.', '--debug'], { cwd: dir });
    assert.strictEqual(result.code, 0, result.stderr);
    assert.match(result.stdout, /River Review doctor/);
    assert.match(result.stdout, /Skills loaded:/);
    assert.match(result.stdout, /Merge base:/);
    assert.match(result.stdout, /--- diff preview ---/);
  });

  test('fails gracefully outside git repos', async (t) => {
    const dir = createTempDir({ prefix: 'river-cli-empty-' });
    t.after(() => cleanupTempDirAsync(dir));
    mkdirSync(resolve(dir, 'nested'));

    const result = await runCliInProcess(['doctor', '.'], { cwd: dir });
    assert.notStrictEqual(result.code, 0);
    assert.match(result.stderr, /Not a git repository/);
  });
});

// -----------------------------------------------------------------------------
// river skills subcommands
// -----------------------------------------------------------------------------

describe('river skills subcommands', () => {
  test('import --loose --dry-run exits 0 with summary', async () => {
    const fixturesDir = resolve('tests', 'fixtures', 'agent-skills');
    const result = await runCliInProcess(
      ['skills', 'import', '--from', fixturesDir, '--loose', '--dry-run'],
      { cwd: process.cwd() }
    );
    assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Import complete/);
  });

  test('list --source rr exits 0 and shows table', async () => {
    const result = await runCliInProcess(['skills', 'list', '--source', 'rr'], {
      cwd: process.cwd(),
    });
    assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /ID/);
    assert.match(result.stdout, /Total:/);
  });

  test('import with empty dir emits warning and exits 0', async (t) => {
    const emptyDir = createTempDir({ prefix: 'river-cli-empty-skills-' });
    t.after(() => cleanupTempDirAsync(emptyDir));

    const result = await runCliInProcess(['skills', 'import', '--from', emptyDir, '--dry-run'], {
      cwd: process.cwd(),
    });
    assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout + result.stderr, /No Agent Skills/);
  });
});

// -----------------------------------------------------------------------------
// river run - JSON output schema conformance (#1154)
// -----------------------------------------------------------------------------

describe('river run - JSON output schema conformance', () => {
  test('--output json conforms to output.schema.json (including prioritySummary)', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'json'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);

    // Validate against output.schema.json using ajv (draft 2020-12)
    const { createRequire } = await import('node:module');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const req = createRequire(import.meta.url);
    const Ajv2020 = req('ajv/dist/2020');
    const schemaPath = fileURLToPath(new URL('../schemas/output.schema.json', import.meta.url));
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    const valid = validate(parsed);
    assert.ok(
      valid,
      `JSON output does not conform to output.schema.json: ${JSON.stringify(validate.errors, null, 2)}`
    );

    // Explicit assertion that prioritySummary is present and well-formed
    assert.ok(
      parsed.summary && typeof parsed.summary.prioritySummary === 'object',
      'summary.prioritySummary should be present'
    );
    const ps = parsed.summary.prioritySummary;
    for (const key of ['P1', 'P2', 'P3', 'P4']) {
      assert.strictEqual(
        typeof ps.counts[key],
        'number',
        `prioritySummary.counts.${key} should be a number`
      );
    }
    assert.strictEqual(
      typeof ps.requiresImmediateAttention,
      'boolean',
      'requiresImmediateAttention should be boolean'
    );
  });
});

// -----------------------------------------------------------------------------
// runtime output.schema.json validation (#1254)
// -----------------------------------------------------------------------------

describe('validateOutputArtifact - runtime schema validation (#1254)', () => {
  test('reports violations to stderr for a non-conforming artifact', async () => {
    const { validateOutputArtifact } = await import('../src/cli.mjs');
    const errors = [];
    const originalError = console.error;
    console.error = (msg) => errors.push(String(msg));
    try {
      // `issues` must be an array per output.schema.json; a string violates it.
      validateOutputArtifact({ issues: 'not-an-array', summary: {} });
    } finally {
      console.error = originalError;
    }
    const combined = errors.join('\n');
    assert.match(
      combined,
      /does not conform to schemas\/output\.schema\.json/,
      `expected a schema-violation warning, got: ${combined}`
    );
  });

  test('stays silent for a conforming artifact', async () => {
    const { validateOutputArtifact } = await import('../src/cli.mjs');
    const errors = [];
    const originalError = console.error;
    console.error = (msg) => errors.push(String(msg));
    try {
      validateOutputArtifact({
        issues: [],
        summary: {
          issueCountBySeverity: { info: 0, minor: 0, major: 0, critical: 0 },
          issueCountByPhase: { upstream: 0, midstream: 0, downstream: 0 },
          prioritySummary: {
            counts: { P1: 0, P2: 0, P3: 0, P4: 0 },
            requiresImmediateAttention: false,
          },
        },
      });
    } finally {
      console.error = originalError;
    }
    assert.strictEqual(errors.length, 0, `expected no warnings, got: ${errors.join('\n')}`);
  });
});

// -----------------------------------------------------------------------------
// river run - JSON output decision field (#1150 S1)
// -----------------------------------------------------------------------------

describe('river run - JSON output decision field', () => {
  const VALID_DECISIONS = ['auto-approve', 'human-review-recommended', 'human-review-required'];

  test('--output json includes decision as a valid enum value', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'json'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok('decision' in parsed, 'top-level decision field should be present');
    assert.ok(
      VALID_DECISIONS.includes(parsed.decision),
      `decision must be one of ${VALID_DECISIONS.join(', ')}, got: ${parsed.decision}`
    );
  });

  test('--output json with no findings produces decision auto-approve', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    // dry-run with no real findings still invokes scoreReview([]) → auto-approve
    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'json'], {
      cwd: dir,
    });

    assert.strictEqual(result.code, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    // When findings are empty, scoreReview([]).verdict must be 'auto-approve'
    if (parsed.issues.length === 0) {
      assert.strictEqual(parsed.decision, 'auto-approve');
    } else {
      assert.ok(
        VALID_DECISIONS.includes(parsed.decision),
        `decision must be a valid enum value, got: ${parsed.decision}`
      );
    }
  });
});

// -----------------------------------------------------------------------------
// river run - gate block (Epic #1347 S2)
// -----------------------------------------------------------------------------
describe('river run - gate block', () => {
  test('dry-run json output gates as NO_GO NOT_EXECUTED (M1 fail-safe)', async (t) => {
    const { dir, cleanup } = await createRepoWithSilentCatchChange();
    t.after(cleanup);

    const result = await runCliInProcess(['run', '.', '--dry-run', '--output', 'json'], {
      cwd: dir,
    });
    assert.strictEqual(result.code, 0, result.stderr);
    const artifact = JSON.parse(result.stdout);
    assert.ok(artifact.gate, 'gate block must be present in run json output');
    // dry-run skips the LLM: a vacuous verdict must never read as converged.
    assert.strictEqual(artifact.gate.decision === 'GO', false, 'dry-run must not GO');
    assert.strictEqual(artifact.gate.inputs.reviewExecuted, false);
  });
});
