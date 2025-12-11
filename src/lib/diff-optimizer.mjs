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
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1));
  const removed = lines
    .filter(line => line.startsWith('-') && !line.startsWith('---'))
    .map(line => line.slice(1));
  if (added.length === 0 && removed.length === 0) return false;
  return normalizeWhitespace(added.join('')) === normalizeWhitespace(removed.join(''));
}

const COMMENT_MARKERS = [/^\/\//, /^\/\*/, /^\*($|\s)/, /^\*\/$/, /^#/, /^<!--/, /^-->/];

function isCommentOnlyChange(lines) {
  const changed = lines.filter(line => line.startsWith('+') || line.startsWith('-'));
  if (!changed.length) return false;
  return changed.every(line => {
    const content = line.slice(1).trim();
    if (!content) return true;
    return COMMENT_MARKERS.some(re => re.test(content));
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
 * @param {{files: Array<{path: string, hunks: Array<{header: string, lines: string[]}>}>}} diff
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
  const reduction = rawTokenEstimate === 0 ? 0 : Math.max(0, Math.round(((rawTokenEstimate - tokenEstimate) / rawTokenEstimate) * 100));

  return {
    files: optimizedFiles,
    diffText,
    tokenEstimate,
    reduction,
    rawTokenEstimate,
  };
}

function renderDiffText(files) {
  if (!files.length) return '';
  const chunks = [];
  for (const file of files) {
    const isNewFile = !file.oldPath || file.oldPath === '/dev/null';
    const isDeletedFile = !file.newPath || file.newPath === '/dev/null';
    const oldPath = isNewFile ? '/dev/null' : file.oldPath ?? file.path;
    const newPath = isDeletedFile ? '/dev/null' : file.newPath ?? file.path;
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
