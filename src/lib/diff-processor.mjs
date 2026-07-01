import { diffWithContext, listChangedFiles } from './git.mjs';
import { classifyChangedFiles } from './file-classifier.mjs';

// ---------------------------------------------------------------------------
// diff-optimizer — filter and compress diff for LLM consumption
// ---------------------------------------------------------------------------

const EXCLUDED_EXTENSIONS = new Set(['.md']);
const EXCLUDED_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const MAX_HUNK_LINES = 200;
const MAX_HUNK_HEAD = 120;
const MAX_HUNK_TAIL = 40;

function extension(path) {
  const idx = path.lastIndexOf('.');
  return idx >= 0 ? path.slice(idx).toLowerCase() : '';
}

function baseName(path) {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function isExcludedFile(path) {
  const ext = extension(path);
  if (EXCLUDED_EXTENSIONS.has(ext)) return true;
  if (EXCLUDED_FILES.has(baseName(path))) return true;
  return false;
}

function normalizeWhitespace(line) {
  return line.replace(/\s+/g, '');
}

function isWhitespaceOnlyChange(lines) {
  const added = lines
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
  const removed = lines
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1));
  if (added.length === 0 && removed.length === 0) return false;
  return normalizeWhitespace(added.join('')) === normalizeWhitespace(removed.join(''));
}

const COMMENT_MARKERS = [/^\/\//, /^\/\*/, /^\*($|\s)/, /^\*\/$/, /^#/, /^<!--/, /^-->/];

function isCommentOnlyChange(lines) {
  const changed = lines.filter((line) => line.startsWith('+') || line.startsWith('-'));
  if (!changed.length) return false;
  return changed.every((line) => {
    const content = line.slice(1).trim();
    if (!content) return true;
    return COMMENT_MARKERS.some((re) => re.test(content));
  });
}

function compressHunkLines(lines) {
  if (lines.length <= MAX_HUNK_LINES) return lines;
  const head = lines.slice(0, MAX_HUNK_HEAD);
  const tail = lines.slice(-MAX_HUNK_TAIL);
  return [...head, '... (hunk truncated) ...', ...tail];
}

/**
 * Filter and compress parsed diff files.
 * @param {{files: Array<{path: string, hunks: Array<{header: string, lines: string[]}>}>, diffText?: string}} diff
 * @returns {{files: Array, diffText: string, tokenEstimate: number, reduction: number, rawTokenEstimate: number}}
 */
export function optimizeDiff(diff) {
  const rawTokenEstimate = Math.ceil((diff.diffText ?? '').length / 4);
  const optimizedFiles = [];

  for (const file of diff.files ?? []) {
    if (isExcludedFile(file.path)) continue;

    const keptHunks = [];
    for (const hunk of file.hunks ?? []) {
      const lines = hunk.lines ?? [];
      if (isWhitespaceOnlyChange(lines)) continue;
      if (isCommentOnlyChange(lines)) continue;

      const compressedLines = compressHunkLines(lines);
      keptHunks.push({
        ...hunk,
        lines: compressedLines,
      });
    }

    if (keptHunks.length) {
      optimizedFiles.push({
        ...file,
        hunks: keptHunks,
      });
    }
  }

  const diffText = renderDiffText(optimizedFiles);
  const tokenEstimate = Math.ceil(diffText.length / 4);
  const reduction =
    rawTokenEstimate === 0
      ? 0
      : Math.max(0, Math.round(((rawTokenEstimate - tokenEstimate) / rawTokenEstimate) * 100));

  return {
    files: optimizedFiles,
    diffText,
    tokenEstimate,
    reduction,
    rawTokenEstimate,
  };
}

export function renderDiffText(files) {
  if (!files.length) return '';
  const chunks = [];
  for (const file of files) {
    const isNewFile = !file.oldPath || file.oldPath === '/dev/null';
    const isDeletedFile = !file.newPath || file.newPath === '/dev/null';
    const oldPath = isNewFile ? '/dev/null' : (file.oldPath ?? file.path);
    const newPath = isDeletedFile ? '/dev/null' : (file.newPath ?? file.path);
    const oldDisplay = oldPath === '/dev/null' ? '/dev/null' : `a/${oldPath}`;
    const newDisplay = newPath === '/dev/null' ? '/dev/null' : `b/${newPath}`;

    chunks.push(`diff --git a/${oldPath} b/${newPath}`);
    chunks.push(`--- ${oldDisplay}`);
    chunks.push(`+++ ${newDisplay}`);
    for (const hunk of file.hunks ?? []) {
      chunks.push(hunk.header);
      chunks.push(...(hunk.lines ?? []));
    }
  }
  return chunks.join('\n');
}

// ---------------------------------------------------------------------------
// diff — parse unified diff and collect repo diff from git
// ---------------------------------------------------------------------------

function stripPrefix(path) {
  if (!path) return path;
  if (path.startsWith('a/')) return path.slice(2);
  if (path.startsWith('b/')) return path.slice(2);
  return path;
}

/**
 * Parse a unified diff into a structured representation.
 * Returns files with hunks and added line hints so downstream consumers
 * can locate where to attach review comments.
 */
export function parseUnifiedDiff(diffText) {
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  let newLineNumber = 0;
  let pendingOldPath = null;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git')) {
      currentHunk = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      pendingOldPath = stripPrefix(line.slice(4).trim());
      continue;
    }
    if (line.startsWith('+++ ')) {
      const newPathRaw = stripPrefix(line.slice(4).trim());
      const isDeletion = newPathRaw === '/dev/null';
      const oldPath = pendingOldPath ?? (isDeletion ? '/dev/null' : newPathRaw);
      const newPath = isDeletion ? '/dev/null' : newPathRaw;
      const path = isDeletion ? oldPath : newPath;

      currentFile = { path, newPath, oldPath, hunks: [], addedLines: [] };
      files.push(currentFile);
      currentHunk = null;
      newLineNumber = 0;
      pendingOldPath = null;
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) continue;
      const oldStart = Number.parseInt(match[1], 10);
      const oldLines = match[2] ? Number.parseInt(match[2], 10) : 1;
      const newStart = Number.parseInt(match[3], 10);
      const newLines = match[4] ? Number.parseInt(match[4], 10) : 1;
      currentHunk = {
        header: line,
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
        addedLines: [],
      };
      currentFile.hunks.push(currentHunk);
      newLineNumber = newStart;
      continue;
    }
    if (!currentHunk) continue;
    currentHunk.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentFile.addedLines.push(newLineNumber);
      currentHunk.addedLines.push(newLineNumber);
      newLineNumber += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // deletion: do not advance new line number
    } else {
      newLineNumber += 1;
    }
  }
  return { files };
}

/**
 * Derive the list of changed file paths from unified diff text,
 * excluding deletions (/dev/null).
 * @param {string} diffText
 * @returns {string[]}
 */
export function deriveChangedFiles(diffText) {
  const parsed = parseUnifiedDiff(diffText);
  const files = parsed.files?.map((f) => f.path).filter(Boolean) ?? [];
  return files.filter((p) => p !== '/dev/null');
}

export async function collectRepoDiff(repoRoot, baseRef, { contextLines = 3 } = {}) {
  const changedFiles = await listChangedFiles(repoRoot, baseRef);
  if (!changedFiles.length) {
    return {
      changedFiles: [],
      rawDiffText: '',
      rawTokenEstimate: 0,
      files: [],
      diffText: '',
      tokenEstimate: 0,
      reduction: 0,
    };
  }

  const rawDiffText = await diffWithContext(repoRoot, baseRef, { unified: contextLines });
  const parsed = parseUnifiedDiff(rawDiffText);
  const files = parsed.files.length
    ? parsed.files
    : changedFiles.map((file) => ({
        path: file,
        hunks: [],
        addedLines: [],
      }));
  const rawTokenEstimate = Math.ceil(rawDiffText.length / 4);
  const optimized = optimizeDiff({ files, diffText: rawDiffText });

  return {
    changedFiles,
    files,
    rawDiffText,
    rawTokenEstimate,
    diffText: optimized.diffText,
    filesForReview: optimized.files,
    tokenEstimate: optimized.tokenEstimate,
    reduction: optimized.reduction,
  };
}

// ---------------------------------------------------------------------------
// diff-meta — extract metadata from diff for review depth control
// ---------------------------------------------------------------------------

/**
 * Count changed lines from raw unified diff text.
 *
 * @param {string} diffText
 * @returns {number}
 */
export function countChangedLinesFromText(diffText) {
  if (!diffText) return 0;
  let lines = 0;
  for (const line of diffText.split('\n')) {
    if (
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---'))
    ) {
      lines++;
    }
  }
  return lines;
}

/**
 * Extract metadata from a diff object for review depth control.
 *
 * @param {{ changedFiles?: string[], diffText?: string }} diff
 * @returns {{ fileCount: number, changedLines: number, fileTypes: object, hasTests: boolean, hasMigrations: boolean, hasSchemas: boolean }}
 */
export function extractDiffMeta(diff) {
  const changedFiles = diff?.changedFiles ?? [];
  const changedLines = countChangedLinesFromText(diff?.diffText);
  const fileTypes = classifyChangedFiles(changedFiles);

  return {
    fileCount: changedFiles.length,
    changedLines,
    fileTypes,
    hasTests: fileTypes.test.length > 0,
    hasMigrations: fileTypes.migration.length > 0,
    hasSchemas: fileTypes.schema.length > 0,
  };
}
