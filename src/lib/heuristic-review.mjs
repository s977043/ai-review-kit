/**
 * スキルIDとヒューリスティック関数のマッピング
 * dry-run 時はこのマッピングに含まれるスキルのみ実行される
 */
export const SKILL_HEURISTIC_MAP = {
  'security-basic': [
    'findHardcodedSecrets',
    'findGitHubActionsIssues',
    'findDangerousEval',
    'findInsecureTls',
    'findWeakHash',
    'findCommandInjection',
  ],
  'logging-observability': ['findSilentCatch', 'findDebuggerLeftover', 'findMergeConflict'],
  'typescript-strict': ['findTsSuppression'],
  'test-existence': ['findMissingTests', 'findFocusedTests', 'findDisabledTests'],
  'coverage-gap': ['findMissingTests', 'findFocusedTests', 'findDisabledTests'],
};

/**
 * ヒューリスティック対応スキルIDの一覧（dry-run 時のフィルタリング用）
 */
export const HEURISTIC_SKILL_IDS = Object.keys(SKILL_HEURISTIC_MAP);

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getSkillId(skill) {
  return skill?.metadata?.id ?? skill?.id ?? null;
}

function hasSkill(plan, skillId) {
  const selected = ensureArray(plan?.selected);
  return selected.some((skill) => getSkillId(skill) === skillId);
}

function* iterateAddedLines(file) {
  const hunks = ensureArray(file?.hunks);
  for (const hunk of hunks) {
    let newLineNumber = hunk.newStart ?? 0;
    for (const rawLine of ensureArray(hunk.lines)) {
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        yield { line: newLineNumber, text: rawLine.slice(1) };
        newLineNumber += 1;
        continue;
      }
      if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        continue;
      }
      newLineNumber += 1;
    }
  }
}

function* iterateHunkLines(file) {
  const hunks = ensureArray(file?.hunks);
  for (const hunk of hunks) {
    let newLineNumber = hunk.newStart ?? 0;
    for (const rawLine of ensureArray(hunk.lines)) {
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        yield { type: 'add', line: newLineNumber, text: rawLine.slice(1) };
        newLineNumber += 1;
        continue;
      }
      if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        yield { type: 'del', line: null, text: rawLine.slice(1) };
        continue;
      }
      // context line (usually starts with a space)
      const text = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine;
      yield { type: 'ctx', line: newLineNumber, text };
      newLineNumber += 1;
    }
  }
}

function isEnvReference(code) {
  return /\b(process\.env|import\.meta\.env)\b/.test(code);
}

function looksLikeLogging(code) {
  return /\b(console\.(?:log|info|warn|error)|logger\.\w+|log\.\w+)\b/.test(code);
}

function matchesHardcodedSecretLine(code) {
  if (isEnvReference(code)) return false;

  // Typical high-signal tokens/keys
  const explicitPatterns = [
    /\bAKIA[0-9A-Z]{16}\b/, // AWS Access Key ID
    /\bghp_[A-Za-z0-9]{36,}\b/, // GitHub token
    /\bsk-(?:live|test)?_[A-Za-z0-9]{16,}\b/, // Stripe-like
    /\bsk-[A-Za-z0-9]{16,}\b/, // OpenAI-like (generic)
  ];
  if (explicitPatterns.some((re) => re.test(code))) return true;

  // Heuristic: suspicious identifier name + long-ish string literal
  const assignMatch =
    /\b(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z0-9_]+)\s*=\s*(?<quote>['"`])(?<value>[^'"`]+)\k<quote>/.exec(
      code
    ) ||
    /['"](?<name>[A-Za-z0-9_]+)['"]\s*:\s*(?<quote>['"`])(?<value>[^'"`]+)\k<quote>/.exec(code) ||
    /\b(?<name>[A-Za-z0-9_]+)\s*:\s*(?<quote>['"`])(?<value>[^'"`]+)\k<quote>/.exec(code);
  if (!assignMatch) return false;

  const name = assignMatch.groups?.name ?? '';
  const value = assignMatch.groups?.value ?? '';
  if (!/(token|secret|api[_-]?key|password|passwd|private[_-]?key)/i.test(name)) return false;
  if (value.length < 10) return false;
  if (/^https?:\/\//i.test(value)) return false;
  return true;
}

function findHardcodedSecrets({ diff }) {
  // Avoid noisy output when many hardcoded values are introduced at once.
  const MAX_HARDCODED_SECRET_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);

  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (looksLikeTestFile(filePath)) continue;
    const normalized = String(filePath).replaceAll('\\', '/');
    if (normalized.includes('/fixtures/') || normalized.includes('/__fixtures__/')) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesHardcodedSecretLine(text)) continue;
      comments.push({
        file: filePath,
        line,
        kind: 'hardcoded-secret',
      });
      if (comments.length >= MAX_HARDCODED_SECRET_COMMENTS) return comments;
    }
  }

  return comments;
}

function matchesSilentCatchLine(code) {
  const lower = code.toLowerCase();
  const hasCatch = lower.includes('catch (') || lower.includes('catch(') || /\bcatch\b/.test(lower);
  if (!hasCatch) return false;
  if (looksLikeLogging(code)) return false;
  if (/\bthrow\b/.test(code)) return false;
  if (/\breturn\s*;\s*(?:\/\/.*)?$/.test(code)) return true;
  if (/\breturn\s+(null|undefined)\s*;\s*(?:\/\/.*)?$/.test(code)) return true;
  if (/\bcatch\s*\([^)]*\)\s*\{\s*\}\s*$/.test(code)) return true;
  return false;
}

function findSilentCatch({ diff }) {
  const comments = [];
  const files = ensureArray(diff?.files);

  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    let catchAnchor = null;
    let window = 0;
    let sawLogOrThrow = false;

    for (const entry of iterateHunkLines(file)) {
      const text = entry.text ?? '';

      // One-liner: catch (...) {}
      if (matchesSilentCatchLine(text) && entry.line != null) {
        comments.push({ file: filePath, line: entry.line, kind: 'silent-catch' });
        if (comments.length >= 3) return comments;
        catchAnchor = null;
        window = 0;
        sawLogOrThrow = false;
        continue;
      }

      if (entry.line != null && /\bcatch\s*\(/.test(text)) {
        catchAnchor = entry.line;
        window = 8;
        sawLogOrThrow = false;
        continue;
      }

      if (window > 0) {
        if (entry.type === 'add') {
          if (looksLikeLogging(text) || /\bthrow\b/.test(text)) {
            sawLogOrThrow = true;
          }
          if (
            !sawLogOrThrow &&
            (/\breturn\s*;\s*(?:\/\/.*)?$/.test(text) ||
              /\breturn\s+(null|undefined)\s*;/.test(text))
          ) {
            comments.push({
              file: filePath,
              line: catchAnchor ?? entry.line ?? 1,
              kind: 'silent-catch',
            });
            if (comments.length >= 3) return comments;
            catchAnchor = null;
            window = 0;
            sawLogOrThrow = false;
            continue;
          }
        }
        window -= 1;
      }
    }
  }

  return comments;
}

function looksLikeTestFile(filePath) {
  const normalized = String(filePath).replaceAll('\\', '/');
  return (
    normalized.startsWith('test/') ||
    normalized.startsWith('tests/') ||
    normalized.startsWith('__tests__/') ||
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    /\.(test|spec)\./.test(normalized)
  );
}

// Strip a trailing `//` line comment, but only when the `//` is NOT inside a
// string literal. A naive `/\/\/.*$/` strip would corrupt lines like
// `const u = "http://x"; eval(y)` (removing the real `eval`). We treat the
// first `//` whose preceding text has balanced quotes as the comment start.
function stripTrailingLineComment(code) {
  const s = String(code);
  let searchFrom = 0;
  for (;;) {
    const idx = s.indexOf('//', searchFrom);
    if (idx === -1) return s;
    const before = s.slice(0, idx);
    const dq = (before.match(/"/g) || []).length;
    const sq = (before.match(/'/g) || []).length;
    const bq = (before.match(/`/g) || []).length;
    if (dq % 2 === 0 && sq % 2 === 0 && bq % 2 === 0) {
      return before;
    }
    searchFrom = idx + 2;
  }
}

function looksLikeProductCodeFile(filePath) {
  const normalized = String(filePath).replaceAll('\\', '/');
  if (looksLikeTestFile(normalized)) return false;
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalized)) return false;
  return (
    normalized.startsWith('src/') ||
    normalized.startsWith('lib/') ||
    normalized.includes('/src/') ||
    normalized.includes('/lib/')
  );
}

function hasBehaviorChangeSignal({ diff }) {
  const files = ensureArray(diff?.files);
  for (const file of files) {
    for (const { text } of iterateAddedLines(file)) {
      if (/\bif\s*\(/.test(text) || /\bswitch\s*\(/.test(text) || /\bthrow\s+new\b/.test(text))
        return true;
    }
  }
  return false;
}

function findMissingTests({ diff }) {
  const files = ensureArray(diff?.files);
  const changedPaths = files
    .map((f) => f?.path)
    .filter(Boolean)
    .filter((p) => p !== '/dev/null');
  const touchesTests = changedPaths.some(looksLikeTestFile);
  const touchesCode = changedPaths.some(looksLikeProductCodeFile);
  if (!touchesCode || touchesTests) return [];
  if (!hasBehaviorChangeSignal({ diff })) return [];

  const firstCodeFile = files.find((f) => looksLikeProductCodeFile(f?.path));
  const filePath = firstCodeFile?.path;
  const line = firstCodeFile?.addedLines?.[0] || firstCodeFile?.hunks?.[0]?.newStart || 1;
  return [
    {
      file: filePath,
      line,
      kind: 'missing-tests',
    },
  ];
}

/**
 * Check if a file path is a GitHub Actions workflow file.
 * @param {string} filePath - File path to check
 * @returns {boolean} True if the file is a workflow YAML file in .github/workflows/
 */
function looksLikeGitHubWorkflowFile(filePath) {
  const normalized = String(filePath).replaceAll('\\', '/');
  return normalized.startsWith('.github/workflows/') && /\.(yml|yaml)$/.test(normalized);
}

/**
 * Detect GitHub Actions security issues in workflow files.
 * Checks for common security vulnerabilities including:
 * - pull_request_target privilege escalation risks
 * - Excessive permissions (write-all)
 * - Secrets exposed in run blocks
 * - Unsanitized user input in run blocks (command injection)
 * @param {{diff: {files?: Array}}} options - Diff object containing file changes
 * @returns {Array<{file: string, line: number, kind: string}>} Array of detected security issues
 */
function findGitHubActionsIssues({ diff }) {
  const MAX_WORKFLOW_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);

  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || !looksLikeGitHubWorkflowFile(filePath)) continue;

    for (const { line, text } of iterateAddedLines(file)) {
      // Check for pull_request_target usage (privilege escalation risk)
      if (
        /^\s*(-\s+)?pull_request_target\s*:?\s*$/.test(text) ||
        /\bon\s*:\s*\[[^\]]*\bpull_request_target\b[^\]]*\]/.test(text)
      ) {
        comments.push({
          file: filePath,
          line,
          kind: 'gh-actions-pull-request-target',
        });
        if (comments.length >= MAX_WORKFLOW_COMMENTS) return comments;
        continue;
      }

      // Check for excessive permissions
      if (/permissions\s*:\s*(write-all|'write-all'|"write-all")/.test(text)) {
        comments.push({
          file: filePath,
          line,
          kind: 'gh-actions-excessive-permissions',
        });
        if (comments.length >= MAX_WORKFLOW_COMMENTS) return comments;
        continue;
      }

      // Check for secrets in run blocks (potential exposure)
      if (/\$\{\{\s*secrets\.\w+\s*\}\}/.test(text) && /run\s*:/.test(text)) {
        comments.push({
          file: filePath,
          line,
          kind: 'gh-actions-secret-in-run',
        });
        if (comments.length >= MAX_WORKFLOW_COMMENTS) return comments;
        continue;
      }

      // Check for unsanitized user input in run blocks (command injection)
      if (
        /run\s*:/.test(text) &&
        /\$\{\{\s*github\.event\.(issue|pull_request|comment)\.(title|body)\s*\}\}/.test(text) &&
        !/\|\s*jq\b/.test(text) &&
        !/toJSON/.test(text)
      ) {
        comments.push({
          file: filePath,
          line,
          kind: 'gh-actions-unsanitized-input',
        });
        if (comments.length >= MAX_WORKFLOW_COMMENTS) return comments;
        continue;
      }
    }
  }

  return comments;
}

// High-confidence code-injection / XSS smells. Deliberately conservative
// (only patterns that are rarely intentional or safe) so the no-LLM path
// stays low-false-positive.
function matchesDangerousEval(code) {
  let trimmed = String(code).trim();
  // Skip comment lines and trailing comments so an `eval` in a comment is
  // not flagged.
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  trimmed = stripTrailingLineComment(trimmed).trim();
  if (/\beval\s*\(/.test(trimmed)) return true;
  if (/\bnew\s+Function\s*\(/.test(trimmed)) return true;
  if (/dangerouslySetInnerHTML/.test(trimmed)) return true;
  if (/\bdocument\.write(?:ln)?\s*\(/.test(trimmed)) return true;
  // A string first argument to a timer is an implicit eval.
  if (/\b(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(trimmed)) return true;
  return false;
}

function findDangerousEval({ diff }) {
  const MAX_DANGEROUS_EVAL_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (looksLikeTestFile(filePath)) continue;
    const normalized = String(filePath).replaceAll('\\', '/');
    if (normalized.includes('/fixtures/') || normalized.includes('/__fixtures__/')) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesDangerousEval(text)) continue;
      comments.push({ file: filePath, line, kind: 'dangerous-eval' });
      if (comments.length >= MAX_DANGEROUS_EVAL_COMMENTS) return comments;
    }
  }
  return comments;
}

// Accidental focused tests (`.only`) silently skip the rest of the suite in CI.
function matchesFocusedTest(code) {
  const trimmed = String(code).trim();
  // Skip comment lines so a commented-out `.only` is not flagged.
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  return /\b(?:describe|context|it|test|suite|bench)\.only\s*\(/.test(trimmed);
}

function findFocusedTests({ diff }) {
  const MAX_FOCUSED_TEST_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (!looksLikeTestFile(filePath)) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesFocusedTest(text)) continue;
      comments.push({ file: filePath, line, kind: 'focused-test' });
      if (comments.length >= MAX_FOCUSED_TEST_COMMENTS) return comments;
    }
  }
  return comments;
}

// Disabled tests (`.skip` / `xit` / `xdescribe`) committed into the suite.
// Advisory only (nit): sometimes intentional for known-pending tests.
function matchesDisabledTest(code) {
  const trimmed = String(code).trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  return (
    /\b(?:describe|context|it|test|suite|bench)\.skip\s*\(/.test(trimmed) ||
    /\b(?:xit|xdescribe|xtest|xcontext)\s*\(/.test(trimmed)
  );
}

function findDisabledTests({ diff }) {
  const MAX_DISABLED_TEST_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (!looksLikeTestFile(filePath)) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesDisabledTest(text)) continue;
      comments.push({ file: filePath, line, kind: 'disabled-test' });
      if (comments.length >= MAX_DISABLED_TEST_COMMENTS) return comments;
    }
  }
  return comments;
}

// Leftover `debugger;` statement (a near-zero-false-positive debug artifact).
function matchesDebuggerLeftover(code) {
  let trimmed = String(code).trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  // Drop a trailing line comment so `const x = 1; // debugger` is not flagged.
  trimmed = stripTrailingLineComment(trimmed).trim();
  return /\bdebugger\s*;/.test(trimmed) || /(?:^|[;{}\s])debugger\s*$/.test(trimmed);
}

function findDebuggerLeftover({ diff }) {
  const MAX_DEBUGGER_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesDebuggerLeftover(text)) continue;
      comments.push({ file: filePath, line, kind: 'debugger-leftover' });
      if (comments.length >= MAX_DEBUGGER_COMMENTS) return comments;
    }
  }
  return comments;
}

// Disabled TLS certificate verification — a near-zero-false-positive security smell.
function matchesInsecureTls(code) {
  const trimmed = String(code).trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  if (/rejectUnauthorized\s*:\s*false/.test(trimmed)) return true;
  // Only when NODE_TLS_REJECT_UNAUTHORIZED is being SET to 0 (which disables
  // verification) — not when it is merely read or set to 1.
  if (/NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*['"`]?0\b/.test(trimmed)) return true;
  return false;
}

function findInsecureTls({ diff }) {
  const MAX_INSECURE_TLS_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (looksLikeTestFile(filePath)) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesInsecureTls(text)) continue;
      comments.push({ file: filePath, line, kind: 'insecure-tls' });
      if (comments.length >= MAX_INSECURE_TLS_COMMENTS) return comments;
    }
  }
  return comments;
}

// Weak hash algorithm via the Node crypto idiom (near-zero false positive).
function matchesWeakHash(code) {
  let trimmed = String(code).trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  trimmed = stripTrailingLineComment(trimmed).trim();
  return /createHash\s*\(\s*['"`](?:md5|sha1)['"`]/i.test(trimmed);
}

function findWeakHash({ diff }) {
  const MAX_WEAK_HASH_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (looksLikeTestFile(filePath)) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesWeakHash(text)) continue;
      comments.push({ file: filePath, line, kind: 'weak-hash' });
      if (comments.length >= MAX_WEAK_HASH_COMMENTS) return comments;
    }
  }
  return comments;
}

// Shell command built from a template literal with interpolation — a command
// injection smell when the interpolated value can be attacker-controlled.
function matchesCommandInjection(code) {
  let trimmed = String(code).trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
  trimmed = stripTrailingLineComment(trimmed).trim();
  // execSync / spawn / spawnSync are unambiguous child_process APIs. Bare `exec`
  // is matched only when NOT a method call (negative lookbehind) so that
  // `regex.exec(`...`)` and `db.exec(`...`)` are not false-flagged.
  return (
    /(?<![.\w])exec\s*\(\s*`[^`]*\$\{/.test(trimmed) ||
    /\b(?:execSync|spawnSync|spawn)\s*\(\s*`[^`]*\$\{/.test(trimmed)
  );
}

function findCommandInjection({ diff }) {
  const MAX_COMMAND_INJECTION_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (looksLikeTestFile(filePath)) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesCommandInjection(text)) continue;
      comments.push({ file: filePath, line, kind: 'command-injection' });
      if (comments.length >= MAX_COMMAND_INJECTION_COMMENTS) return comments;
    }
  }
  return comments;
}

// Unresolved git conflict markers committed into a file. The `<<<<<<<` /
// `>>>>>>>` markers are unambiguous; `=======` is intentionally excluded
// (it collides with Markdown h1 underlines).
function matchesMergeConflict(code) {
  // <<<<<<< / >>>>>>> are always present; ||||||| is the diff3/zdiff3 base
  // marker. ======= is intentionally excluded (Markdown h1-underline collision).
  return /^<{7}(?:\s|$)/.test(code) || /^>{7}(?:\s|$)/.test(code) || /^\|{7}(?:\s|$)/.test(code);
}

function findMergeConflict({ diff }) {
  const MAX_MERGE_CONFLICT_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesMergeConflict(text)) continue;
      comments.push({ file: filePath, line, kind: 'merge-conflict' });
      if (comments.length >= MAX_MERGE_CONFLICT_COMMENTS) return comments;
    }
  }
  return comments;
}

// `@ts-ignore` / `@ts-nocheck` suppress type checking. `@ts-expect-error` is
// the recommended, scoped form and is intentionally NOT flagged.
function matchesTsSuppression(code) {
  return /@ts-ignore\b/.test(code) || /@ts-nocheck\b/.test(code);
}

function findTsSuppression({ diff }) {
  const MAX_TS_SUPPRESSION_COMMENTS = 3;
  const comments = [];
  const files = ensureArray(diff?.files);
  for (const file of files) {
    const filePath = file?.path;
    if (!filePath || filePath === '/dev/null') continue;
    if (looksLikeTestFile(filePath)) continue;
    for (const { line, text } of iterateAddedLines(file)) {
      if (!matchesTsSuppression(text)) continue;
      comments.push({ file: filePath, line, kind: 'ts-suppression' });
      if (comments.length >= MAX_TS_SUPPRESSION_COMMENTS) return comments;
    }
  }
  return comments;
}

/**
 * Generate deterministic review comments from heuristics.
 * These comments are used as a fallback when LLM is not available.
 * @param {{diff: {files?: Array}, plan: {selected?: Array}}} options
 */
export function buildHeuristicComments({ diff, plan }) {
  const comments = [];

  // セキュリティ基本チェック
  if (hasSkill(plan, 'security-basic')) {
    const skillId = 'security-basic';
    for (const c of findHardcodedSecrets({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findGitHubActionsIssues({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findDangerousEval({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findInsecureTls({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findWeakHash({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findCommandInjection({ diff })) {
      comments.push({ ...c, skillId });
    }
  }

  // ロギング・可観測性チェック
  if (hasSkill(plan, 'logging-observability')) {
    const skillId = 'logging-observability';
    for (const c of findSilentCatch({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findDebuggerLeftover({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findMergeConflict({ diff })) {
      comments.push({ ...c, skillId });
    }
  }

  // TypeScript 型チェック抑制
  if (hasSkill(plan, 'typescript-strict')) {
    const skillId = 'typescript-strict';
    for (const c of findTsSuppression({ diff })) {
      comments.push({ ...c, skillId });
    }
  }

  // テスト存在チェック
  if (hasSkill(plan, 'test-existence')) {
    const skillId = 'test-existence';
    for (const c of findMissingTests({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findFocusedTests({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findDisabledTests({ diff })) {
      comments.push({ ...c, skillId });
    }
  } else if (hasSkill(plan, 'coverage-gap')) {
    const skillId = 'coverage-gap';
    for (const c of findMissingTests({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findFocusedTests({ diff })) {
      comments.push({ ...c, skillId });
    }
    for (const c of findDisabledTests({ diff })) {
      comments.push({ ...c, skillId });
    }
  }

  return comments.slice(0, 8);
}
