import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub generateReview before importing the orchestrator
const generateReviewStub = mock.fn(async ({ projectRules }) => ({
  comments: [
    {
      file: 'src/foo.mjs',
      line: 1,
      message: `Finding: issue Evidence: found in ${projectRules?.slice(0, 20) ?? ''}`,
    },
  ],
  findings: [
    {
      id: 'rr-1',
      ruleId: 'some-rule',
      file: 'src/foo.mjs',
      lineStart: 1,
      lineEnd: 1,
      title: 'test finding',
      message:
        'Finding: issue Evidence: found in diff Impact: medium Fix: fix it Severity: major Confidence: high',
      severity: 'major',
      confidence: 'high',
      status: 'open',
      evidence: ['found in diff with enough characters to pass threshold here'],
    },
  ],
  classified: { overview: [], suppressed: [], inlineCandidates: [] },
  prompt: 'prompt text',
  promptTruncated: false,
  llmModel: 'gpt-4o',
  debug: {},
}));

// Patch the module before import via mock.module
const {
  runReviewerOrchestration,
  REVIEWER_ROLES,
  DEFAULT_REVIEWERS,
  resolveReviewerRoles,
  selectRolesAuto,
  splitDiffIntoChunks,
  deduplicateFindings,
  mergeFindings,
} = await (() => {
  // We can't easily mock ESM imports in node:test without a loader.
  // Instead, import the real module and test its observable behaviour.
  return import('../src/lib/reviewer-orchestrator.mjs');
})();

function makeDiff() {
  return { diffText: 'diff --git a/src/foo.mjs', files: [], filesForReview: [] };
}

describe('REVIEWER_ROLES', () => {
  it('exports bug-hunter, security-scanner, test-gap', () => {
    assert.ok('bug-hunter' in REVIEWER_ROLES);
    assert.ok('security-scanner' in REVIEWER_ROLES);
    assert.ok('test-gap' in REVIEWER_ROLES);
  });

  it('each role has label and focusInstructions', () => {
    for (const [, role] of Object.entries(REVIEWER_ROLES)) {
      assert.ok(typeof role.label === 'string' && role.label.length > 0);
      assert.ok(typeof role.focusInstructions === 'string' && role.focusInstructions.length > 10);
    }
  });
});

describe('DEFAULT_REVIEWERS', () => {
  it('contains bug-hunter and security-scanner', () => {
    assert.ok(DEFAULT_REVIEWERS.includes('bug-hunter'));
    assert.ok(DEFAULT_REVIEWERS.includes('security-scanner'));
  });
});

describe('resolveReviewerRoles', () => {
  it('returns valid and invalid split', () => {
    const { valid, invalid } = resolveReviewerRoles(['bug-hunter', 'nonexistent']);
    assert.deepEqual(valid, ['bug-hunter']);
    assert.deepEqual(invalid, ['nonexistent']);
  });

  it('uses DEFAULT_REVIEWERS when input is null', () => {
    const { valid, invalid } = resolveReviewerRoles(null);
    assert.deepEqual(valid, DEFAULT_REVIEWERS);
    assert.deepEqual(invalid, []);
  });

  it('uses DEFAULT_REVIEWERS when input is undefined', () => {
    const { valid } = resolveReviewerRoles(undefined);
    assert.deepEqual(valid, DEFAULT_REVIEWERS);
  });
});

describe('runReviewerOrchestration', () => {
  it('throws when no valid roles are provided', async () => {
    await assert.rejects(
      () => runReviewerOrchestration({ diff: makeDiff(), reviewers: ['nonexistent'] }),
      /No valid reviewer roles/
    );
  });

  it('returns reviewerResults with role metadata', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['bug-hunter', 'security-scanner'],
    });
    assert.equal(result.reviewerResults.length, 2);
    assert.equal(result.reviewerResults[0].role, 'bug-hunter');
    assert.equal(result.reviewerResults[0].label, REVIEWER_ROLES['bug-hunter'].label);
    assert.ok('status' in result.reviewerResults[0]);
    assert.ok('findingsCount' in result.reviewerResults[0]);
  });

  it('tags all findings with reviewerRole', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['bug-hunter'],
    });
    for (const f of result.findings) {
      assert.ok(typeof f.reviewerRole === 'string', `finding ${f.id} missing reviewerRole`);
    }
  });

  it('assigns unique finding IDs across multiple reviewers', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['bug-hunter', 'security-scanner', 'test-gap'],
    });
    const ids = result.findings.map((f) => f.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'finding IDs must be unique');
  });

  it('returns classified findings object', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['bug-hunter'],
    });
    assert.ok(result.classified, 'classified must be present');
    assert.ok(Array.isArray(result.classified.overview));
    assert.ok(Array.isArray(result.classified.suppressed));
    assert.ok(Array.isArray(result.classified.inlineCandidates));
  });

  it('uses DEFAULT_REVIEWERS when reviewers is not specified', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
    });
    const roles = result.reviewerResults.map((r) => r.role);
    assert.deepEqual(roles, DEFAULT_REVIEWERS);
  });

  it('returns invalidRoles list for unknown roles', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['bug-hunter', 'unknown-role'],
    });
    assert.ok(Array.isArray(result.invalidRoles));
    assert.ok(result.invalidRoles.includes('unknown-role'));
  });

  it('returns comments array', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['bug-hunter'],
    });
    assert.ok(Array.isArray(result.comments));
  });

  it('returns debug metadata', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['bug-hunter', 'security-scanner'],
    });
    assert.ok(typeof result.debug.succeededReviewers === 'number');
    assert.ok(typeof result.debug.failedReviewers === 'number');
    assert.ok(typeof result.debug.deduplicatedCount === 'number');
  });

  it('auto mode expands roles based on fileTypes', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['auto'],
      fileTypes: {
        test: ['foo.test.mjs'],
        app: ['src/foo.mjs'],
        config: [],
        schema: [],
        migration: [],
        infra: [],
      },
      riskAssessment: { humanReviewFiles: [], escalatedFiles: [] },
    });
    assert.ok(result.autoSelectedRoles !== null, 'autoSelectedRoles should be set in auto mode');
    assert.ok(result.autoSelectedRoles.includes('bug-hunter'));
    assert.ok(result.autoSelectedRoles.includes('test-gap'), 'test files → test-gap');
  });

  it('auto mode adds security-scanner for risky files', async () => {
    const result = await runReviewerOrchestration({
      diff: makeDiff(),
      dryRun: true,
      reviewers: ['auto'],
      fileTypes: {
        test: [],
        app: [],
        config: ['config.json'],
        schema: [],
        migration: [],
        infra: [],
      },
      riskAssessment: { humanReviewFiles: ['config.json'], escalatedFiles: [] },
    });
    assert.ok(result.autoSelectedRoles.includes('security-scanner'));
  });
});

describe('selectRolesAuto', () => {
  it('always includes bug-hunter', () => {
    const roles = selectRolesAuto({}, null);
    assert.ok(roles.includes('bug-hunter'));
  });

  it('adds test-gap when test files are present', () => {
    const roles = selectRolesAuto(
      { test: ['foo.test.ts'], app: [], config: [], schema: [], migration: [], infra: [] },
      null
    );
    assert.ok(roles.includes('test-gap'));
  });

  it('adds test-gap when many app files changed', () => {
    const roles = selectRolesAuto(
      { test: [], app: ['a.ts', 'b.ts', 'c.ts'], config: [], schema: [], migration: [], infra: [] },
      null
    );
    assert.ok(roles.includes('test-gap'));
  });

  it('adds security-scanner for config/schema changes', () => {
    const roles = selectRolesAuto(
      { test: [], app: [], config: ['app.config.ts'], schema: [], migration: [], infra: [] },
      null
    );
    assert.ok(roles.includes('security-scanner'));
  });

  it('adds security-scanner for escalated risk files', () => {
    const roles = selectRolesAuto({}, { humanReviewFiles: [], escalatedFiles: ['auth.ts'] });
    assert.ok(roles.includes('security-scanner'));
  });

  it('returns only bug-hunter when no signals', () => {
    const roles = selectRolesAuto(
      { test: [], app: ['a.ts', 'b.ts'], config: [], schema: [], migration: [], infra: [] },
      { humanReviewFiles: [], escalatedFiles: [] }
    );
    assert.deepEqual(roles, ['bug-hunter']);
  });
});

describe('splitDiffIntoChunks', () => {
  function makeFile(path, lines = 10) {
    return { path, hunks: [{ header: '@@ -1 +1 @@', lines: Array(lines).fill('+line') }] };
  }

  it('returns null for small diffs', () => {
    const diff = { files: [makeFile('src/a.ts'), makeFile('src/b.ts')] };
    assert.equal(splitDiffIntoChunks(diff), null);
  });

  it('splits large diffs into chunks', () => {
    // Use distinct top-level directories so grouping produces multiple chunks
    const dirs = ['api', 'ui', 'lib', 'tests', 'config'];
    const files = Array.from({ length: 15 }, (_, i) =>
      makeFile(`${dirs[i % dirs.length]}/file${i}.ts`, 20)
    );
    const diff = { files, filesForReview: files, diffText: '' };
    const chunks = splitDiffIntoChunks(diff);
    assert.ok(chunks !== null);
    assert.ok(chunks.length >= 2, `expected ≥2 chunks, got ${chunks?.length}`);
    // All files must appear in exactly one chunk
    const allPaths = chunks.flatMap((c) => c.files.map((f) => f.path));
    assert.equal(allPaths.length, files.length);
    assert.equal(new Set(allPaths).size, files.length, 'no duplicates');
  });

  it('chunks contain diffText', () => {
    const files = Array.from({ length: 12 }, (_, i) => makeFile(`pkg${i % 4}/f${i}.ts`, 60));
    const diff = { files, filesForReview: files, diffText: '' };
    const chunks = splitDiffIntoChunks(diff);
    assert.ok(chunks !== null);
    for (const chunk of chunks) {
      assert.ok(typeof chunk.diffText === 'string');
    }
  });
});

describe('deduplicateFindings', () => {
  function makeF(file, line, message) {
    return { file, lineStart: line, message, title: message };
  }

  it('keeps unique findings', () => {
    const findings = [makeF('a.ts', 1, 'bug A'), makeF('b.ts', 5, 'bug B')];
    assert.equal(deduplicateFindings(findings).length, 2);
  });

  it('removes exact duplicates', () => {
    const f = makeF('a.ts', 1, 'null dereference on line 1 of function foo bar');
    assert.equal(deduplicateFindings([f, { ...f }]).length, 1);
  });

  it('removes near-duplicates same file same line', () => {
    const f1 = makeF('a.ts', 10, 'null pointer dereference in handleRequest');
    const f2 = makeF('a.ts', 10, 'null pointer dereference in handleRequest func');
    assert.equal(deduplicateFindings([f1, f2]).length, 1);
  });

  it('keeps findings on different lines', () => {
    const f1 = makeF('a.ts', 10, 'null pointer');
    const f2 = makeF('a.ts', 50, 'null pointer');
    assert.equal(deduplicateFindings([f1, f2]).length, 2);
  });

  it('keeps findings on different files', () => {
    const f1 = makeF('a.ts', 10, 'null pointer dereference on handleRequest');
    const f2 = makeF('b.ts', 10, 'null pointer dereference on handleRequest');
    assert.equal(deduplicateFindings([f1, f2]).length, 2);
  });
});

describe('mergeFindings', () => {
  function makeF(file, line, message, severity = 'major', reviewerRole, evidence = []) {
    return { file, lineStart: line, message, title: message, severity, reviewerRole, evidence };
  }

  it('merges duplicate findings with max severity (major+critical → critical)', () => {
    const f1 = makeF(
      'a.ts',
      10,
      'null pointer dereference in handleRequest',
      'major',
      'bug-hunter',
      ['line 10']
    );
    const f2 = makeF(
      'a.ts',
      10,
      'null pointer dereference in handleRequest',
      'critical',
      'security-scanner',
      ['line 10 ctx']
    );
    const result = mergeFindings([f1, f2]);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, 'critical');
  });

  it('unions evidence arrays and deduplicates', () => {
    const f1 = makeF(
      'a.ts',
      10,
      'null pointer dereference in handleRequest',
      'major',
      'bug-hunter',
      ['shared evidence', 'unique A']
    );
    const f2 = makeF(
      'a.ts',
      10,
      'null pointer dereference in handleRequest',
      'major',
      'security-scanner',
      ['shared evidence', 'unique B']
    );
    const result = mergeFindings([f1, f2]);
    assert.equal(result.length, 1);
    const ev = result[0].evidence;
    assert.ok(ev.includes('shared evidence'), 'shared evidence present');
    assert.ok(ev.includes('unique A'), 'unique A present');
    assert.ok(ev.includes('unique B'), 'unique B present');
    // shared evidence deduplicated: should appear once
    assert.equal(ev.filter((e) => e === 'shared evidence').length, 1);
  });

  it('agreement array contains both reviewer roles', () => {
    const f1 = makeF(
      'a.ts',
      10,
      'null pointer dereference in handleRequest',
      'major',
      'bug-hunter',
      []
    );
    const f2 = makeF(
      'a.ts',
      10,
      'null pointer dereference in handleRequest',
      'minor',
      'security-scanner',
      []
    );
    const result = mergeFindings([f1, f2]);
    assert.equal(result.length, 1);
    assert.ok(result[0].agreement.includes('bug-hunter'));
    assert.ok(result[0].agreement.includes('security-scanner'));
  });

  it('non-duplicate findings pass through unchanged with agreement=[own role]', () => {
    const f1 = makeF('a.ts', 1, 'bug A', 'major', 'bug-hunter', ['ev1']);
    const f2 = makeF('b.ts', 5, 'bug B', 'minor', 'security-scanner', ['ev2']);
    const result = mergeFindings([f1, f2]);
    assert.equal(result.length, 2);
    assert.equal(result[0].agreement.length, 1);
    assert.equal(result[0].agreement[0], 'bug-hunter');
    assert.equal(result[1].agreement[0], 'security-scanner');
  });

  it('preserves existing fields on merged finding (backward compat)', () => {
    const f1 = {
      ...makeF('a.ts', 10, 'null pointer dereference in handleRequest', 'major', 'bug-hunter', []),
      id: 'rr-1',
      ruleId: 'some-rule',
      title: 'Null pointer',
      phase: 'midstream',
      confidence: 'high',
    };
    const f2 = makeF(
      'a.ts',
      10,
      'null pointer dereference in handleRequest',
      'major',
      'security-scanner',
      []
    );
    const result = mergeFindings([f1, f2]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'rr-1');
    assert.equal(result[0].ruleId, 'some-rule');
    assert.equal(result[0].phase, 'midstream');
    assert.equal(result[0].confidence, 'high');
    assert.equal(result[0].file, 'a.ts');
    assert.equal(result[0].message, 'null pointer dereference in handleRequest');
  });
});
