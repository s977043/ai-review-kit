// `river evolve` subcommand handler (#1574 P1 Shadow aggregate / P2 Paired replay).
//
// Stable CLI surface (契約4) for the read-only outer loop:
//
//   river evolve aggregate [<path>] [--min <n>] [--month YYYY-MM] [--output json|text]
//   river evolve replay --spec <file> [--expect-manifest <id|key>] [--output json|text]
//
// Both subcommands only READ. `aggregate` reads `.river/runs/` and
// `.river/feedback/*.jsonl`; `replay` reads a single experiment spec file that
// already contains the baseline and candidate runs. Neither has an `--out` /
// `--promote` style option: writing into Riverbed, Skills, rules, or the gate
// belongs to #1568's promotion lifecycle, and re-running a review belongs to
// `river run` — so no code path here can mutate a repository or spend an API
// call. Redirect stdout if you need the JSON on disk.

/**
 * Handle the `evolve` command (aggregate | replay).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runEvolveCommand(parsed, targetPath) {
  const subcommand = parsed.evolveSubcommand ?? 'aggregate';
  if (subcommand !== 'aggregate' && subcommand !== 'replay') {
    console.error(`Unknown evolve subcommand: ${subcommand}. Use: aggregate | replay`);
    return 1;
  }
  if (parsed.evolveUnknownOption) {
    console.error(
      `Unknown option for evolve: ${parsed.evolveUnknownOption}. Use: --min <n> --month YYYY-MM --spec <file> --expect-manifest <id> --output text|json`
    );
    return 1;
  }
  if (parsed.evolveExtraArgs?.length) {
    console.error(
      `Unexpected argument(s) for evolve ${subcommand}: ${parsed.evolveExtraArgs.join(', ')}`
    );
    return 1;
  }
  // Neither subcommand has a yaml/html renderer; accepting the flag and silently
  // emitting text would misreport the format to a downstream consumer.
  const output = parsed.output ?? 'text';
  if (output !== 'text' && output !== 'json') {
    console.error(`Unsupported --output for evolve ${subcommand}: ${output}. Use: text | json`);
    return 1;
  }

  if (subcommand === 'replay') {
    return runReplay(parsed, output);
  }
  return runAggregate(parsed, targetPath, output);
}

async function runAggregate(parsed, targetPath, output) {
  // `--spec` / `--expect-manifest` belong to `replay`. Accepting them silently
  // here would look like the aggregate honoured an experiment definition.
  const misplaced = ['--spec', '--expect-manifest'].filter(
    (flag) => (flag === '--spec' ? parsed.evolveSpec : parsed.evolveExpectManifest) != null
  );
  if (misplaced.length) {
    console.error(
      `${misplaced.join(', ')} is only valid for \`river evolve replay\`, not for aggregate.`
    );
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

  if (output === 'json') {
    console.log(JSON.stringify(aggregate, null, 2));
  } else {
    console.log(formatShadowAggregateMarkdown(aggregate));
  }
  // Always exit 0: this is an observation, not a gate (#1574 P1 is shadow-only).
  return 0;
}

async function runReplay(parsed, output) {
  if (!parsed.evolveSpec) {
    console.error(
      'Error: `river evolve replay` requires --spec <file> (the experiment specification).'
    );
    return 1;
  }
  if (parsed.evolveMin != null || parsed.evolveMonth != null) {
    // These scope the aggregate's inputs; the replay's dataset is fixed by the
    // manifest, so honouring them would silently change the pinned dataset.
    console.error('Error: --min / --month are aggregate options and are not valid for replay.');
    return 1;
  }

  const { readFile } = await import('node:fs/promises');
  const { buildPairedReplay, formatPairedReplayMarkdown, PairedReplayError } =
    await import('../../lib/paired-replay.mjs');

  let spec;
  try {
    spec = JSON.parse(await readFile(parsed.evolveSpec, 'utf8'));
  } catch (err) {
    console.error(`Error: cannot read --spec ${parsed.evolveSpec}: ${err.message}`);
    return 1;
  }
  // Checked before any property access: a file containing `null` or `[]` would
  // otherwise throw a raw TypeError on `spec.manifest` instead of a usage error.
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    console.error(`Error: --spec ${parsed.evolveSpec} must contain a JSON object.`);
    return 1;
  }

  let result;
  try {
    result = buildPairedReplay(spec, {
      now: new Date(),
      manifest: spec.manifest ?? undefined,
    });
  } catch (err) {
    if (err instanceof PairedReplayError) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    throw err;
  }

  // A tampered or stale manifest invalidates the comparison, so it fails loudly
  // instead of printing a report that looks authoritative.
  if (!result.manifestVerification.verified) {
    console.error(
      `Error: Experiment Manifest verification failed: ${result.manifestVerification.mismatches.join('; ')}`
    );
    return 1;
  }
  if (!result.manifestVerification.experimentKeyMatchesInputs) {
    console.error(
      `Error: the supplied manifest describes a different experiment (recomputed experimentKey ${result.manifestVerification.recomputedExperimentKey}).`
    );
    return 1;
  }
  if (parsed.evolveExpectManifest) {
    const expected = parsed.evolveExpectManifest;
    const matches =
      expected === result.manifest.manifestId ||
      expected === result.manifest.experimentKey ||
      expected === result.manifest.manifestHash;
    if (!matches) {
      console.error(
        `Error: --expect-manifest ${expected} does not match this experiment (manifestId ${result.manifest.manifestId}).`
      );
      return 1;
    }
  }

  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPairedReplayMarkdown(result));
  }
  // Exit 0 even when the acceptance criteria are not met: P2 reports material
  // for a human judgement and is explicitly not a gate (自動 canary は保留).
  return 0;
}
