import { classifyChangedFiles } from './file-classifier.mjs';

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
