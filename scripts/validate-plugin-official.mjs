// Run the Claude Code OFFICIAL plugin validator (`claude plugin validate`)
// against this repository's manifests.
//
// Why a wrapper instead of a bare npm script:
//
//  1. Two invocations are required. The argument decides which manifest the
//     CLI reads: passing a DIRECTORY validates `.claude-plugin/marketplace.json`
//     only, while the plugin manifest (plus the root CLAUDE.md and the files
//     under commands/ and agents/) is reached only by naming
//     `.claude-plugin/plugin.json` explicitly. Neither form is a superset of
//     the other, so both must run.
//
//  2. Two of the warnings `--strict` reports are accepted, not fixable (see
//     ACCEPTED_WARNINGS below for the per-item reasoning). A plain
//     `claude plugin validate --strict` therefore always exits 1 here and
//     would carry no signal. This wrapper keeps `--strict` (so unrecognized
//     fields and missing metadata are still surfaced) but fails only on
//     findings that are NOT on the accepted list — i.e. it is a regression
//     gate for NEW warnings.
//
//  3. `claude` is not installed on GitHub Actions runners. When the CLI is
//     absent the wrapper reports SKIP and exits 0, so it stays safe to call
//     from any environment. It is wired as a local-only `npm run
//     plugin:validate:official` target, not as a CI step.
//
// This wrapper never replaces `npm run plugin:validate`
// (scripts/validate-plugin-manifest.mjs), which checks repo-specific rules the
// official validator knows nothing about (cross-manifest parity with
// .codex-plugin, asset registration, version sync). Run both.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { isDirectRun } from './lib/is-direct-run.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Targets to validate, in order. The CLI resolves each argument differently:
 * a path to a plugin manifest validates the plugin (and its commands/agents/
 * CLAUDE.md); a directory validates the marketplace manifest.
 */
export const TARGETS = [
  { arg: '.claude-plugin/plugin.json', label: 'plugin manifest + commands/agents' },
  { arg: '.', label: 'marketplace manifest' },
];

/**
 * Warnings that `--strict` reports and that this repository has consciously
 * decided NOT to fix. Each entry documents why. Anything not matched here
 * fails the check.
 */
export const ACCEPTED_WARNINGS = [
  {
    id: 'unknown-field-composer-icon',
    pattern: /Unknown field 'composerIcon'/,
    reason:
      'composerIcon is required by the Codex bundle contract (.codex-plugin/plugin.json interface.composerIcon) and scripts/validate-plugin-manifest.mjs enforces parity between the two manifests (checkCrossManifestParity). Claude Code merely ignores the field at load time, so keeping it costs nothing and dropping it would mean relaxing our own parity check.',
  },
  {
    id: 'root-claude-md-not-context',
    pattern: /CLAUDE\.md at the plugin root is not loaded as project context/,
    reason:
      "The root CLAUDE.md is this repository's OWN agent instructions; it is not intended to ship as plugin context. The distributed context lives in skills/. The validator has no exclusion mechanism, so this warning is accepted rather than fixed.",
  },
];

/**
 * Parse the CLI's human-readable output into findings.
 *
 * Both errors and warnings are printed as `  ❯ <message>` lines; only the
 * preceding section header distinguishes them ("✘ Found N errors:" vs
 * "⚠ Found N warning(s):"). Findings seen before any header are treated as
 * errors (fail-safe).
 *
 * Pure function; exported for unit testing.
 *
 * @param {string} output combined stdout+stderr of one CLI invocation
 * @returns {{kind: 'error'|'warning', message: string}[]}
 */
export function parseFindings(output) {
  const findings = [];
  let kind = 'error';
  for (const line of String(output ?? '').split('\n')) {
    if (/^\s*⚠\s+Found\s+\d+\s+warning/.test(line)) {
      kind = 'warning';
      continue;
    }
    if (/^\s*✘\s+Found\s+\d+\s+error/.test(line)) {
      kind = 'error';
      continue;
    }
    const match = line.match(/^\s*❯\s+(.*\S)\s*$/);
    if (match) findings.push({ kind, message: match[1] });
  }
  return findings;
}

/**
 * Split findings into accepted (documented, ignorable) and blocking ones.
 * Errors are never accepted, only warnings can be.
 *
 * Pure function; exported for unit testing.
 *
 * @param {{kind: string, message: string}[]} findings
 * @param {typeof ACCEPTED_WARNINGS} accepted
 * @returns {{accepted: object[], blocking: object[]}}
 */
export function classifyFindings(findings, accepted = ACCEPTED_WARNINGS) {
  const result = { accepted: [], blocking: [] };
  for (const finding of findings) {
    const rule =
      finding.kind === 'warning'
        ? accepted.find((a) => a.pattern.test(finding.message))
        : undefined;
    if (rule) result.accepted.push({ ...finding, id: rule.id });
    else result.blocking.push(finding);
  }
  return result;
}

/** Whether the `claude` CLI is callable in this environment. */
export function claudeCliAvailable(run = spawnSync) {
  const probe = run('claude', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/**
 * Run the official validator over every target and classify the output.
 *
 * @returns {{skipped: boolean, blocking: object[], accepted: object[], transcript: string}}
 */
export function validateWithOfficialCli(run = spawnSync) {
  if (!claudeCliAvailable(run)) {
    return { skipped: true, blocking: [], accepted: [], transcript: '' };
  }

  const blocking = [];
  const accepted = [];
  const transcript = [];

  for (const target of TARGETS) {
    const proc = run('claude', ['plugin', 'validate', target.arg, '--strict'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
    transcript.push(
      `--- claude plugin validate ${target.arg} --strict (${target.label})\n${output}`
    );

    const classified = classifyFindings(parseFindings(output));
    for (const finding of classified.blocking) blocking.push({ ...finding, target: target.arg });
    for (const finding of classified.accepted) accepted.push({ ...finding, target: target.arg });

    // Non-zero exit with no parsed finding means the CLI failed for a reason
    // this parser does not model (crash, changed output format). Fail loudly
    // rather than silently passing.
    if (proc.status !== 0 && classified.blocking.length === 0 && classified.accepted.length === 0) {
      blocking.push({
        kind: 'error',
        message: `claude plugin validate ${target.arg} exited ${proc.status} with no parsable finding`,
        target: target.arg,
      });
    }
  }

  return { skipped: false, blocking, accepted, transcript: transcript.join('\n') };
}

// CLI entry point
if (isDirectRun(import.meta.url)) {
  const result = validateWithOfficialCli();
  if (result.skipped) {
    console.log(
      'Official plugin validator: SKIP (the `claude` CLI is not available in this environment)'
    );
  } else {
    console.log(result.transcript);
    for (const finding of result.accepted) {
      console.log(`Accepted warning [${finding.id}] (${finding.target}): ${finding.message}`);
    }
    if (result.blocking.length > 0) {
      console.error(`Official plugin validator: ${result.blocking.length} blocking finding(s)`);
      for (const finding of result.blocking) {
        console.error(`  - [${finding.kind}] (${finding.target}) ${finding.message}`);
      }
      console.error(
        'Fix the finding, or — if it is a warning this repo consciously accepts — add it to ' +
          'ACCEPTED_WARNINGS in scripts/validate-plugin-official.mjs with a reason.'
      );
      process.exitCode = 1;
    } else {
      console.log('Official plugin validator: OK (no unaccepted findings)');
    }
  }
}
