#!/usr/bin/env node
// Execute the FEEDBACK_TO_FIXTURE.md conversion table over captured feedback
// entries (.river/feedback/*.jsonl): print the repository action per entry
// and, with --write, create fixture stubs for false_positive / missed_issue.
// Applying the scaffolds remains a human decision in PR review
// (docs/development/skill-improvement-loop-design.md §3 L2 / §6).
//
// Usage: node scripts/apply-feedback.mjs [--month YYYY-MM] [--write]
import path from 'path';
import { promises as fs, realpathSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { listFeedbackEntries, buildFeedbackScaffold } from '../src/lib/feedback.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function applyFeedback({
  month = null,
  write = false,
  root = repoRoot,
  log = console.log,
} = {}) {
  const entries = await listFeedbackEntries({
    repoRoot: root,
    month,
    warn: (m) => console.warn(m),
  });
  if (!entries.length) {
    log('No feedback entries found under .river/feedback/.');
    return { entries: 0, written: [] };
  }
  const written = [];
  for (const entry of entries) {
    const scaffold = buildFeedbackScaffold(entry);
    log(`\n[${entry.timestamp}] ${entry.feedbackType} — ${entry.skillId}`);
    log(`  action: ${scaffold.action}`);
    if (scaffold.command) log(`  command: ${scaffold.command}`);
    if (scaffold.note) log(`  note: ${scaffold.note}`);
    log(`  verify: ${scaffold.verify.join(' && ')}`);
    if (scaffold.fixtureStub) {
      const target = path.join(root, scaffold.fixtureStub.suggestedPath);
      if (write) {
        try {
          await fs.access(target);
          log(`  fixture: ${scaffold.fixtureStub.suggestedPath} (exists, skipped)`);
        } catch {
          try {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, scaffold.fixtureStub.content, 'utf8');
            written.push(scaffold.fixtureStub.suggestedPath);
            log(`  fixture: ${scaffold.fixtureStub.suggestedPath} (stub written — fill TODOs)`);
          } catch (err) {
            console.error(
              `  fixture: failed to write ${scaffold.fixtureStub.suggestedPath}: ${err.message}`
            );
          }
        }
      } else {
        log(`  fixture: ${scaffold.fixtureStub.suggestedPath} (pass --write to create the stub)`);
      }
    }
  }
  return { entries: entries.length, written };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const monthIdx = args.indexOf('--month');
  const month = monthIdx >= 0 ? args[monthIdx + 1] : null;
  const write = args.includes('--write');
  await applyFeedback({ month, write });
}
