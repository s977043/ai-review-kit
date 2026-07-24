// `river evolve` subcommand handler (#1574 P1 Shadow aggregate).
//
// Stable CLI surface (契約4) for the read-only outer loop:
//
//   river evolve aggregate [<path>] [--min <n>] [--month YYYY-MM] [--output json|text]
//
// The command only READS `.river/runs/` and `.river/feedback/*.jsonl` and
// prints the aggregate to stdout. It intentionally has no `--out` / `--promote`
// style option: writing into Riverbed, Skills, rules, or the gate is P3/P4
// work and belongs to #1568's promotion lifecycle, so P1 offers no code path
// that could mutate a repository surface at all. Redirect stdout if you need
// the candidate JSON on disk.

/**
 * Handle the `evolve` command (aggregate).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runEvolveCommand(parsed, targetPath) {
  const subcommand = parsed.evolveSubcommand ?? 'aggregate';
  if (subcommand !== 'aggregate') {
    console.error(`Unknown evolve subcommand: ${subcommand}. Use: aggregate`);
    return 1;
  }

  const { resolveStoreDir, loadAllRunRecords } = await import('../../lib/result-store.mjs');
  const { listFeedbackEntries } = await import('../../lib/feedback.mjs');
  const { buildShadowAggregate, formatShadowAggregateMarkdown, DEFAULT_MIN_RECURRENCE } =
    await import('../../lib/shadow-aggregate.mjs');

  const storeDir = resolveStoreDir(targetPath);
  const runRecords = await loadAllRunRecords(storeDir);
  const feedbackEntries = await listFeedbackEntries({
    repoRoot: targetPath,
    month: parsed.evolveMonth ?? null,
    warn: (message) => console.warn(message),
  });

  const aggregate = buildShadowAggregate({
    runRecords,
    feedbackEntries,
    minRecurrence: parsed.evolveMin ?? DEFAULT_MIN_RECURRENCE,
    month: parsed.evolveMonth ?? null,
    now: new Date(),
  });

  if (parsed.output === 'json') {
    console.log(JSON.stringify(aggregate, null, 2));
  } else {
    console.log(formatShadowAggregateMarkdown(aggregate));
  }
  // Always exit 0: this is an observation, not a gate (#1574 P1 is shadow-only).
  return 0;
}
