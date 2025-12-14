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

function isEnvReference(code) {
  return /\b(process\.env|import\.meta\.env)\b/.test(code);
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
        message:
          '秘密情報（トークン/キー）の直書きの可能性があります。環境変数（GitHub Secrets等）へ移し、漏洩時はローテーションも検討してください。',
      });
      if (comments.length >= MAX_HARDCODED_SECRET_COMMENTS) return comments;
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

  if (hasSkill(plan, 'rr-midstream-security-basic-001')) {
    comments.push(...findHardcodedSecrets({ diff }));
  }

  return comments.slice(0, 8);
}
