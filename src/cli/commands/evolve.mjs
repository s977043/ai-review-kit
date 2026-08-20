// `river evolve` subcommand handler (#1574 P1 Shadow aggregate / P2 Paired replay).
//
// Stable CLI surface (契約4) for the read-only outer loop:
//
//   river evolve aggregate [<path>] [--min <n>] [--month YYYY-MM] [--output json|text]
//   river evolve replay --spec <file> [--expect-manifest <id|key>] [--output json|text]
//   river evolve prompt-compare [<path>] [--output json|text]
//
// All three subcommands only READ. `aggregate` reads `.river/runs/` and
// `.river/feedback/*.jsonl`; `replay` reads a single experiment spec file that
// already contains the baseline and candidate runs; `prompt-compare` reads
// `.river/runs/` and pairs the legacy prompt against the compiled prompt from
// the observe-mode records those runs already carry (ADR-006 / #1860) — it
// never sends the compiled prompt anywhere. None has an `--out` / `--promote`
// style option: writing into Riverbed, Skills, rules, or the gate belongs to
// #1568's promotion lifecycle, and re-running a review belongs to `river run` —
// so no code path here can mutate a repository or spend an API call. Redirect
// stdout if you need the JSON on disk.

import { existsSync } from 'node:fs';

const SUBCOMMANDS = ['aggregate', 'replay', 'prompt-compare'];

/**
 * Warn when the positional path handed to `aggregate` does not exist (#1936).
 *
 * `resolveStoreDir()` happily resolves `<nonexistent>/.river/runs`, so a
 * mistyped path produced a well-formed report with `Runs | 0` and exit 0 —
 * byte-identical to the legitimate "no runs saved yet" report. The two cases
 * were indistinguishable from the output alone.
 *
 * The condition is deliberately "the path does not exist", NOT "the store is
 * empty". An empty store is the normal state of a first-ever run, of a repo
 * right after `setup-team`, and of a `--month` scope with no runs in it;
 * warning there would fire on every one of them. Non-existence, by contrast,
 * can only be a wrong path. This is the same carve-out
 * `warnWhenFingerprintMatchesNoFinding` (src/cli/commands/feedback.mjs) makes
 * for #1823 残件2: advisory on stderr, never a change of exit code, and silent
 * when there is simply no data.
 *
 * `existsSync` is also what src/cli.mjs already uses for this decision in three
 * places (the eager evolve branch, `takeTrailingPositional`, and the post-`--`
 * positional loop); the gap was only the positional that follows an explicit
 * subcommand word. Note that it returns true for a FILE too — narrowing to
 * directories would reject `evolve aggregate ./some-file`, which is a separate
 * (and unrequested) behavior change, so it is left alone.
 *
 * @param {string} targetPath - resolved positional path.
 * @param {string} rawTarget - the token as the user typed it.
 */
function warnWhenTargetPathMissing(targetPath, rawTarget) {
  if (existsSync(targetPath)) return;
  console.warn(
    `Warning: "${rawTarget}" does not exist, so this aggregate read an empty store ` +
      'instead of the runs you meant. Check the path, or omit it to aggregate the current directory.'
  );
}

/**
 * Handle the `evolve` command (aggregate | replay | prompt-compare).
 *
 * @param {Record<string, unknown>} parsed - parseArgs() result.
 * @param {string} targetPath - resolved repo target path.
 * @returns {Promise<number>} process exit code.
 */
export async function runEvolveCommand(parsed, targetPath) {
  const subcommand = parsed.evolveSubcommand ?? 'aggregate';
  if (!SUBCOMMANDS.includes(subcommand)) {
    console.error(`Unknown evolve subcommand: ${subcommand}. Use: ${SUBCOMMANDS.join(' | ')}`);
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
  if (subcommand === 'prompt-compare') {
    return runPromptCompare(parsed, targetPath, output);
  }
  return runAggregate(parsed, targetPath, output);
}

/**
 * `river evolve prompt-compare` — legacy と compiled の paired 比較（#1860）。
 *
 * 保存済み run の `debug.execution.promptCompiler` を読むだけである。
 * レビューの再実行も compiled prompt の送信も行わない。
 */
async function runPromptCompare(parsed, targetPath, output) {
  const misplaced = ['--spec', '--expect-manifest', '--min', '--month'].filter((flag) => {
    if (flag === '--spec') return parsed.evolveSpec != null;
    if (flag === '--expect-manifest') return parsed.evolveExpectManifest != null;
    if (flag === '--min') return parsed.evolveMin != null;
    return parsed.evolveMonth != null;
  });
  if (misplaced.length) {
    console.error(
      `${misplaced.join(', ')} is not valid for \`river evolve prompt-compare\` (its dataset is the saved runs under .river/runs).`
    );
    return 1;
  }

  const { resolveStoreDir, loadAllRunRecords } = await import('../../lib/result-store.mjs');
  const { buildPromptComparison, formatPromptComparisonMarkdown, PromptComparisonError } =
    await import('../../lib/prompt-compiler-paired.mjs');
  const { PairedReplayError } = await import('../../lib/paired-replay.mjs');

  const runRecords = await loadAllRunRecords(resolveStoreDir(targetPath));

  let result;
  try {
    result = buildPromptComparison({ runRecords, now: new Date() });
  } catch (err) {
    // Both are usage-level: the dataset cannot support the comparison. The
    // message says which condition failed, so exit 1 stays actionable.
    if (err instanceof PromptComparisonError || err instanceof PairedReplayError) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    throw err;
  }

  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPromptComparisonMarkdown(result));
  }
  // Exit 0: this is an observation, never a gate (自動 canary は保留).
  return 0;
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

  warnWhenTargetPathMissing(targetPath, parsed.target ?? targetPath);

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
    // #1823 残件2: same sink shape as listFeedbackEntries above. The builder
    // defaults it to a no-op to stay side-effect free, so the CLI is what makes
    // an unmatched findingFingerprint audible.
    warn: (message) => console.warn(message),
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
    // A manifest created before the evidence provenance summary was pinned
    // (#1719, v1.68.0 and earlier) hashes a smaller condition set, so it lands
    // here even though its own digests verify. Without this hint the only
    // reading left is "wrong file", and the fix — rebuild the manifest — is not
    // discoverable.
    console.error(
      'Hint: manifests created by v1.68.0 or earlier do not pin manifest.<side>.provenance (#1719); their experimentKey no longer matches this spec. Rebuild the manifest from the spec.'
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
