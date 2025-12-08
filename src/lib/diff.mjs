import { diffWithContext, listChangedFiles } from './git.mjs';

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

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git')) {
      currentHunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = stripPrefix(line.slice(4).trim());
      if (path === '/dev/null') {
        currentFile = null;
        currentHunk = null;
        continue;
      }
      currentFile = { path, hunks: [], addedLines: [] };
      files.push(currentFile);
      currentHunk = null;
      newLineNumber = 0;
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

export async function collectRepoDiff(repoRoot, baseRef, { contextLines = 3 } = {}) {
  const changedFiles = await listChangedFiles(repoRoot, baseRef);
  if (!changedFiles.length) {
    return {
      changedFiles: [],
      files: [],
      diffText: '',
      tokenEstimate: 0,
      addedLineHints: new Map(),
    };
  }

  const diffText = await diffWithContext(repoRoot, baseRef, { unified: contextLines });
  const parsed = parseUnifiedDiff(diffText);
  const files = parsed.files.length
    ? parsed.files
    : changedFiles.map(file => ({
        path: file,
        hunks: [],
        addedLines: [],
      }));
  const addedLineHints = new Map(files.map(file => [file.path, file.addedLines[0] ?? 1]));
  const tokenEstimate = Math.ceil(diffText.length / 4);

  return {
    changedFiles,
    files,
    diffText,
    tokenEstimate,
    addedLineHints,
  };
}
