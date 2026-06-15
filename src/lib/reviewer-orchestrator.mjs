import { generateReview } from './review-engine.mjs';
import { classifyFindings } from './finding-classifier.mjs';
import { renderDiffText } from './diff-optimizer.mjs';

export const REVIEWER_ROLES = {
  'bug-hunter': {
    label: 'Bug Hunter',
    focusInstructions: `You are the Bug Hunter reviewer. Focus exclusively on:
- Logic errors, off-by-one mistakes, incorrect boolean conditions
- Null/undefined dereference and missing guard clauses
- Edge cases (empty collections, negative values, concurrent access)
- Incorrect or swallowed error handling
Report only issues in these categories. Do NOT report security vulnerabilities or style issues.`,
  },
  'security-scanner': {
    label: 'Security Scanner',
    focusInstructions: `You are the Security Scanner reviewer. Focus exclusively on:
- Injection vulnerabilities (SQL, shell command, path traversal, template injection)
- Authentication and authorization bypasses
- Sensitive data exposure (hardcoded secrets, PII in logs, tokens in URLs)
- Insecure defaults, missing input validation at trust boundaries
Report only security issues. Do NOT report logic bugs or style concerns.`,
  },
  'test-gap': {
    label: 'Test Gap Finder',
    focusInstructions: `You are the Test Gap Finder reviewer. Focus exclusively on:
- New or changed code paths that lack test coverage
- Missing edge-case tests (boundary values, error paths, empty inputs)
- Tests that are present but do not assert meaningful outcomes
Report only test coverage gaps. Do NOT report implementation bugs or style issues.`,
  },
};

export const DEFAULT_REVIEWERS = ['bug-hunter', 'security-scanner'];

// Thresholds for diff splitting
const SPLIT_FILE_THRESHOLD = 10;
const SPLIT_LINE_THRESHOLD = 500;

export function resolveReviewerRoles(reviewers, { fileTypes, riskAssessment } = {}) {
  // 'auto' keyword: derive roles from diff content
  if (reviewers?.length === 1 && reviewers[0] === 'auto') {
    return { valid: selectRolesAuto(fileTypes, riskAssessment), invalid: [] };
  }
  const names = reviewers ?? DEFAULT_REVIEWERS;
  const valid = names.filter((n) => REVIEWER_ROLES[n]);
  const invalid = names.filter((n) => !REVIEWER_ROLES[n]);
  return { valid, invalid };
}

/**
 * Automatically select reviewer roles based on diff content signals.
 * Always includes bug-hunter; adds security-scanner and test-gap when relevant.
 */
export function selectRolesAuto(fileTypes, riskAssessment) {
  const roles = new Set(['bug-hunter']);

  // Security: risky files or config/infra/schema changes
  const riskyFiles =
    (riskAssessment?.humanReviewFiles?.length ?? 0) + (riskAssessment?.escalatedFiles?.length ?? 0);
  const infraFiles =
    (fileTypes?.config?.length ?? 0) +
    (fileTypes?.schema?.length ?? 0) +
    (fileTypes?.migration?.length ?? 0) +
    (fileTypes?.infra?.length ?? 0);
  if (riskyFiles > 0 || infraFiles > 0) {
    roles.add('security-scanner');
  }

  // Test gap: test files changed or new app files without accompanying tests
  const testFiles = fileTypes?.test?.length ?? 0;
  const appFiles = fileTypes?.app?.length ?? 0;
  if (testFiles > 0 || appFiles > 2) {
    roles.add('test-gap');
  }

  return [...roles];
}

/**
 * Split diff files into groups for parallel chunk execution.
 * Groups by directory prefix to keep related files together.
 */
export function splitDiffIntoChunks(diff) {
  const files = diff.files ?? [];
  const totalLines = files.reduce(
    (sum, f) => sum + (f.hunks ?? []).reduce((s, h) => s + (h.lines?.length ?? 0), 0),
    0
  );

  if (files.length <= SPLIT_FILE_THRESHOLD && totalLines <= SPLIT_LINE_THRESHOLD) {
    return null; // No split needed
  }

  // Group files by top-level directory
  const groups = new Map();
  for (const file of files) {
    const dir = file.path.split('/')[0] ?? '_root';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }

  // Merge small groups to avoid excessive chunks (target: 2–4 chunks)
  const targetChunks = Math.min(4, Math.ceil(files.length / SPLIT_FILE_THRESHOLD));
  const buckets = [];
  for (const groupFiles of groups.values()) {
    if (buckets.length < targetChunks) {
      buckets.push([...groupFiles]);
    } else {
      // Append to smallest bucket
      buckets.sort((a, b) => a.length - b.length);
      buckets[0].push(...groupFiles);
    }
  }

  return buckets
    .filter((b) => b.length > 0)
    .map((chunkFiles) => ({
      ...diff,
      files: chunkFiles,
      filesForReview: chunkFiles,
      diffText: renderDiffText(chunkFiles),
      _chunkLabel: chunkFiles
        .map((f) => f.path)
        .join(', ')
        .slice(0, 60),
    }));
}

const SEVERITY_ORDER = ['info', 'minor', 'major', 'critical'];

/**
 * Normalize a severity string to one of the canonical schema values.
 * Accepts both output schema values (critical/major/minor/info) and
 * internal LLM prompt values (blocker/warning/nit).
 * Unknown values fall back to 'major' per review-core.md.
 *
 * @param {string} severity
 * @returns {'critical' | 'major' | 'minor' | 'info'}
 */
function normalizeSeverityLocal(severity) {
  const s = String(severity ?? '')
    .toLowerCase()
    .trim();
  if (s === 'critical' || s === 'blocker') return 'critical';
  if (s === 'major' || s === 'warning') return 'major';
  if (s === 'minor' || s === 'nit') return 'minor';
  if (s === 'info') return 'info';
  return 'major'; // fail-safe per review-core.md
}

function maxSeverity(a, b) {
  const na = normalizeSeverityLocal(a);
  const nb = normalizeSeverityLocal(b);
  const ai = SEVERITY_ORDER.indexOf(na);
  const bi = SEVERITY_ORDER.indexOf(nb);
  return SEVERITY_ORDER[Math.max(ai, bi)];
}

/**
 * Predicate: returns true when two findings are considered duplicates.
 * Criteria: same file, line positions within ±2, and message edit-distance ≤ 10
 * (compared on the first 80 chars, lower-cased).
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function findingsOverlap(a, b) {
  if (a.file !== b.file) return false;
  const lineOverlap = Math.abs((a.lineStart ?? a.line ?? 0) - (b.lineStart ?? b.line ?? 0)) <= 2;
  if (!lineOverlap) return false;
  const msgA = (a.message ?? a.title ?? '').slice(0, 80).toLowerCase();
  const msgB = (b.message ?? b.title ?? '').slice(0, 80).toLowerCase();
  return editDistance(msgA, msgB) <= 10;
}

/**
 * Merge findings across reviewers using connected-components clustering.
 *
 * Two findings that are mutually overlapping (per findingsOverlap) are placed
 * in the same component. Because the graph may form A–B–C chains where A and C
 * are NOT directly overlapping, a union-find (path-compressed) is used so that
 * all transitively connected findings collapse into one cluster regardless of
 * input order.
 *
 * Each cluster produces ONE canonical finding (the first member) with:
 *   - severity = max of cluster (after normalization of blocker/warning/nit)
 *   - evidence = deduplicated union of all evidence arrays
 *   - agreement = array of all reviewerRole values in the cluster
 * Non-duplicate findings pass through unchanged, with agreement = [their reviewerRole] if set.
 */
export function mergeFindings(findings) {
  const n = findings.length;
  if (n === 0) return [];

  // Union-Find with path halving
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  }
  function union(x, y) {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[ry] = rx;
  }

  // Build adjacency: O(n²) — acceptable for typical review finding counts
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (findingsOverlap(findings[i], findings[j])) {
        union(i, j);
      }
    }
  }

  // Group indices by root representative, preserving insertion order
  const clusterMap = new Map(); // root → [indices]
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root).push(i);
  }

  return [...clusterMap.values()].map((indices) => {
    const canonical = { ...findings[indices[0]] };
    if (indices.length === 1) {
      // Passthrough: attach agreement with own role, preserving existing
      const role = canonical.reviewerRole;
      const existingAgreement = Array.isArray(canonical.agreement) ? canonical.agreement : [];
      const agreementSet = new Set(existingAgreement);
      if (role) agreementSet.add(role);
      return {
        ...canonical,
        severity: normalizeSeverityLocal(canonical.severity),
        agreement: [...agreementSet],
      };
    }

    // Merge cluster: max severity, union evidence, collect agreement
    let mergedSeverity = canonical.severity;
    const evidenceSet = new Set(Array.isArray(canonical.evidence) ? canonical.evidence : []);
    const agreementSet = new Set(Array.isArray(canonical.agreement) ? canonical.agreement : []);
    if (canonical.reviewerRole) agreementSet.add(canonical.reviewerRole);

    for (const idx of indices.slice(1)) {
      const m = findings[idx];
      mergedSeverity = maxSeverity(mergedSeverity, m.severity);
      for (const e of Array.isArray(m.evidence) ? m.evidence : []) evidenceSet.add(e);
      for (const a of Array.isArray(m.agreement) ? m.agreement : []) agreementSet.add(a);
      if (m.reviewerRole) agreementSet.add(m.reviewerRole);
    }

    return {
      ...canonical,
      severity: mergedSeverity,
      evidence: [...evidenceSet],
      agreement: [...agreementSet],
    };
  });
}

/**
 * Deduplicate findings across parallel runs.
 * Two findings are considered duplicates if findingsOverlap returns true.
 */
export function deduplicateFindings(findings) {
  const seen = [];
  const result = [];

  for (const f of findings) {
    const isDuplicate = seen.some((s) => findingsOverlap(s, f));

    if (!isDuplicate) {
      seen.push(f);
      result.push(f);
    }
  }

  return result;
}

function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Only compute if strings are similar enough to be worth comparing
  if (Math.abs(m - n) > 15) return 99;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export async function runReviewerOrchestration({
  diff,
  plan,
  phase,
  dryRun = false,
  model,
  apiKey,
  projectRules,
  riskAssessment,
  memoryContext,
  fileTypes,
  relatedADRs,
  reviewMode,
  config,
  reviewers,
  prBody,
} = {}) {
  const { valid: roles, invalid } = resolveReviewerRoles(reviewers, { fileTypes, riskAssessment });

  if (!roles.length) {
    throw new Error(
      `No valid reviewer roles. Got: [${(reviewers ?? []).join(', ')}]. Valid: [${Object.keys(REVIEWER_ROLES).join(', ')}]`
    );
  }

  // Attempt diff splitting for large PRs
  const diffChunks = splitDiffIntoChunks(diff);
  const chunked = diffChunks !== null;
  const diffsToProcess = chunked ? diffChunks : [diff];

  const generateArgs = {
    plan,
    phase,
    dryRun,
    model,
    apiKey,
    riskAssessment,
    memoryContext,
    fileTypes,
    relatedADRs,
    reviewMode,
    config,
    prBody,
  };

  // Fan out: each role × each diff chunk runs in parallel
  const tasks = roles.flatMap((roleName) =>
    diffsToProcess.map((chunkDiff, chunkIdx) => {
      const role = REVIEWER_ROLES[roleName];
      const roleRules = [role.focusInstructions, projectRules].filter(Boolean).join('\n\n');
      return generateReview({ ...generateArgs, diff: chunkDiff, projectRules: roleRules }).then(
        (result) => ({
          ...result,
          reviewerRole: roleName,
          chunkIdx: chunked ? chunkIdx : null,
          chunkLabel: chunked ? (chunkDiff._chunkLabel ?? `chunk-${chunkIdx}`) : null,
        })
      );
    })
  );

  // Run each role in parallel; partial failure is tolerated
  const settled = await Promise.allSettled(tasks);

  const succeeded = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = settled.filter((r) => r.status === 'rejected');

  // Merge findings, deduplicate across chunks/roles, then assign stable IDs
  let nextId = 1;
  const rawFindings = succeeded.flatMap((r) =>
    (r.findings ?? []).map((f) => ({
      ...f,
      reviewerRole: r.reviewerRole,
      chunkLabel: r.chunkLabel ?? null,
    }))
  );
  const deduped = mergeFindings(rawFindings);
  const allFindings = deduped.map((f) => ({ ...f, id: `rr-${nextId++}` }));

  const allComments = succeeded.flatMap((r) => r.comments ?? []);
  const classified = classifyFindings(allFindings, { reviewMode: reviewMode ?? 'medium' });

  // Summarise per-role results (aggregate across chunks)
  const reviewerResults = roles.map((name) => {
    const roleSettled = settled.filter(
      (_, i) => tasks[i] && roles.flatMap((r) => diffsToProcess.map(() => r))[i] === name
    );
    const roleSucceeded = roleSettled.filter((r) => r.status === 'fulfilled');
    return {
      role: name,
      label: REVIEWER_ROLES[name].label,
      status: roleSucceeded.length > 0 ? 'fulfilled' : 'rejected',
      findingsCount: roleSucceeded.reduce((sum, r) => sum + (r.value?.findings?.length ?? 0), 0),
      chunksRun: chunked ? diffsToProcess.length : null,
      error:
        roleSucceeded.length === 0 ? String(roleSettled[0]?.reason?.message ?? 'unknown') : null,
    };
  });

  return {
    comments: allComments,
    findings: allFindings,
    classified,
    reviewerResults,
    invalidRoles: invalid,
    autoSelectedRoles: reviewers?.length === 1 && reviewers[0] === 'auto' ? roles : null,
    chunked,
    chunkCount: chunked ? diffsToProcess.length : null,
    prompt: succeeded[0]?.prompt ?? null,
    promptTruncated: succeeded.some((r) => r.promptTruncated),
    llmModel: succeeded[0]?.llmModel ?? null,
    debug: {
      succeededReviewers: succeeded.length,
      failedReviewers: failed.length,
      deduplicatedCount: rawFindings.length - allFindings.length,
    },
  };
}
