function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getSkillId(skill) {
  return skill?.metadata?.id ?? skill?.id ?? null;
}

function hasSkill(plan, skillId) {
  const selected = ensureArray(plan?.selected);
  return selected.some(skill => getSkillId(skill) === skillId);
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
  if (explicitPatterns.some(re => re.test(code))) return true;

  // Heuristic: suspicious identifier name + long-ish string literal
  const assignMatch =
    /\b(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z0-9_]+)\s*=\s*(?<quote>['"`])(?<value>[^'"`]+)\k<quote>/.exec(
      code,
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
          if (!sawLogOrThrow && (/\breturn\s*;\s*(?:\/\/.*)?$/.test(text) || /\breturn\s+(null|undefined)\s*;/.test(text))) {
            comments.push({ file: filePath, line: catchAnchor ?? entry.line ?? 1, kind: 'silent-catch' });
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
  return normalized.includes('/tests/') || normalized.includes('/__tests__/') || /\.(test|spec)\./.test(normalized);
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
      if (/\bif\s*\(/.test(text) || /\bswitch\s*\(/.test(text) || /\bthrow\s+new\b/.test(text)) return true;
    }
  }
  return false;
}

function findMissingTests({ diff }) {
  const files = ensureArray(diff?.files);
  const changedPaths = files
    .map(f => f?.path)
    .filter(Boolean)
    .filter(p => p !== '/dev/null');
  const touchesTests = changedPaths.some(looksLikeTestFile);
  const touchesCode = changedPaths.some(looksLikeProductCodeFile);
  if (!touchesCode || touchesTests) return [];
  if (!hasBehaviorChangeSignal({ diff })) return [];

  const firstCodeFile = files.find(f => looksLikeProductCodeFile(f?.path));
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
 * Generate deterministic review comments from heuristics.
 * These comments are used as a fallback when LLM is not available.
 * @param {{diff: {files?: Array}, plan: {selected?: Array}}} options
 */
export function buildHeuristicComments({ diff, plan }) {
  const comments = [];

  if (hasSkill(plan, 'rr-midstream-security-basic-001')) {
    comments.push(...findHardcodedSecrets({ diff }));
  }

  if (hasSkill(plan, 'rr-midstream-logging-observability-001')) {
    comments.push(...findSilentCatch({ diff }));
  }

  if (hasSkill(plan, 'rr-downstream-test-existence-001') || hasSkill(plan, 'rr-downstream-coverage-gap-001')) {
    comments.push(...findMissingTests({ diff }));
  }

  return comments.slice(0, 8);
}
