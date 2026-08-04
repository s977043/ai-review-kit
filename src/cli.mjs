#!/usr/bin/env node
import {
  existsSync,
  realpathSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GitError, GitRepoNotFoundError } from './lib/git.mjs';
import { SkillLoaderError } from '../runners/core/skill-loader.mjs';
import { ProjectRulesError } from './lib/rules.mjs';
import { RiskMapError } from './lib/risk-map.mjs';
import { parseList } from './lib/utils.mjs';
import { PLANNER_MODES } from './lib/planner-utils.mjs';
import { DEPTH_TO_REVIEW_MODE } from './lib/review-plan-generator.mjs';
import { runReviewCommand } from './cli/commands/review.mjs';
import { runSkillsCommand } from './cli/commands/skills.mjs';
import { runRunsCommand } from './cli/commands/runs.mjs';
import { runEvalCommand } from './cli/commands/eval.mjs';
import { runFeedbackCommand } from './cli/commands/feedback.mjs';
import { runSuppressionCommand } from './cli/commands/suppression.mjs';
import { runDoctorCommand } from './cli/commands/doctor.mjs';
import { runRunCommand } from './cli/commands/run.mjs';
import { runPromoteCommand } from './cli/commands/promote.mjs';
import { runEvolveCommand } from './cli/commands/evolve.mjs';
import {
  printHintLines,
  printExplain,
  isLlmlessEmptyReview,
  validateOutputArtifact,
} from './cli/render.mjs';

function printHelp() {
  console.log(`Usage: river <command> <path> [options]

Commands:
  run <path>            Run River Review locally against the git repo at <path>
  skills <path>         Run the new Skill-based Reviewer architecture
  skills import         Import Agent Skills (SKILL.md) into River Review
  skills export         Export River Review skills to Agent Skills format
  skills list           List all skills (RR and Agent Skills)
  skills resolve        Show which skills apply to the given --path files
  doctor <path>         Check setup and print hints for common issues
  review plan           Resolve upstream artifacts and emit a Review Artifact
                        (Phase 3 slice: --plan-only only)
  review exec           Run the review and emit a Review Artifact with findings
                        (--dry-run: plan only; --plan <file>: replay an existing plan)
  review route          Recommend a review mode (light|standard|team|human-required)
                        for the current diff (--format json|markdown; --base <ref>)
  eval                  Run review fixtures evaluation (must_include checks)
  suppression add       Create a Riverbed Memory suppression entry
                        (--fingerprint --feedback --rationale [--scope]
                         [--severity] [--files] [--expires] [--pr])
  feedback add          Record a review feedback entry (.river/feedback/)
                        (--type --skill [--trigger] [--fingerprint] [--evidence]
                         [--pr] [--reviewer] [--model] [--reversed-by] [--run-id])
  promote propose       Create (or converge on) one promotion candidate from an
                        explicit feedback JSONL selection. The candidate id is a
                        content hash of (evidence, cluster, policy version), so
                        re-running with the same evidence is idempotent.
                        (--input <jsonl> --cluster-key <skillId::feedbackType>
                         [--policy-version <v>] [--threshold <n>] [--index <path>]
                         [--dry-run])
                        Not safe to run in parallel against the same --index:
                        the index is rewritten read-modify-write, so concurrent
                        proposes can lose one another's entry. Serialize calls.
  promote list          List promotion_candidate entries (Judgment Promotion Loop Phase 2)
  promote approve <id>  Approve a candidate (promotionStatus -> approved)
  promote reject <id>   Reject a candidate (promotionStatus -> archived)
  promote template [<id>] Emit PR scaffold(s) for approved candidate(s) (text only)
                        (--approver <name> --reason <text> --index <path>
                         --include-inactive; --output json for machine output)
  promote retire        Retire promotion candidates: archive on expiresAt and
                        sync promotionStatus to the retired entry status (Phase 3)
  promote review-effectiveness [<id>]
                        Review post-activation feedback; flag needs_review when
                        false-positive/reversal signals reach --threshold
                        (--threshold <n> --feedback-root <path> --index <path>)
  evolve aggregate <path>
                        Read-only shadow aggregate over saved runs + feedback
                        (#1574 P1). Prints evidence provenance, two-stage
                        clusters, and at most one shadow candidate. Writes
                        nothing (--min <n> --month YYYY-MM; --output json)
  evolve replay         Read-only paired replay of an experiment spec
                        (#1574 P2). Pins an immutable Experiment Manifest,
                        pairs baseline vs candidate findings, and reports the
                        delta against the declared per-profile acceptance
                        criteria. Never re-runs a review and never decides
                        adoption (--spec <file> --expect-manifest <id>;
                        --output json)

Skills Subcommand Options:
  --from <path>         (import) Source directory to scan for SKILL.md files
  --to <path>           (import) Output dir for converted skills / (export) Output dir for SKILL.md
  --strict              (import) Require full RR schema compliance (default)
  --loose               (import) Accept minimal name/description, auto-fill missing fields
  --source <type>       (list) Filter: rr|agent|all (default: all)
  --include-assets      (export) Copy references/ scripts/ prompt/ alongside SKILL.md
  --path <file>         (resolve) File to resolve skills for; repeatable, at least one required
  --dry-run             (import) Validate without writing files

Options:
  --phase <phase>   Review phase (upstream|midstream|downstream). Default: env RIVER_PHASE or midstream
  --planner <mode>  Planner mode (off|order|prune). Default: env RIVER_PLANNER_MODE or off
  --dry-run         Do not call external services; print results to stdout
  --debug           Print debug information (merge base, files, token estimate)
  --explain         Print which skills / gates / config tier were resolved (to stderr)
  --estimate        Print cost estimate only (no review)
  --max-cost <usd>  Abort if estimated cost exceeds this USD amount
  --output <mode>   Output format: text|markdown|json|yaml|html. Default: text
  --format <mode>   (review) Output format for review plan|exec|verify|route: text|markdown|json. Takes
                    precedence over --output; plan|exec reject a conflicting explicit pair.
                    Default: json (text is parsed but not implemented for review yet)
  --context list    Comma-separated available contexts (e.g. diff,fullFile,tests). Overrides RIVER_AVAILABLE_CONTEXTS
  --dependency list Comma-separated available dependencies (e.g. code_search,test_runner). Overrides RIVER_AVAILABLE_DEPENDENCIES
  --reviewers list  Comma-separated reviewer roles for parallel orchestration (e.g. bug-hunter,security-scanner,test-gap).
                    Use "auto" to select roles automatically based on diff content and risk signals.
  --baseline <path> Path to a previous review JSON (findings array) for regression comparison
  --base <ref>      Branch or ref to diff against (e.g. main). Default: auto-detected default branch
  --skill-set <name> Restrict review to a named skill set from skills/registry.yaml
                    (e.g. basic, typescript, comprehensive). Default: all applicable skills
  --depth <name>    Force review depth: quick|standard|thorough. Default: auto-detected from diff size
  --save            Persist the review run to the project result store (.river/runs/)
  --fail-on <sev>   (run/review) Exit 1 if a finding >= severity exists. Opt-in; default critical when set
  --warn-on <sev>   (run/review) Exit 2 if a finding >= severity exists (below --fail-on). Default major when set
  --advisory-only   (run/review) Report findings but always exit 0 (disables --fail-on/--warn-on gating)
  --gate            (run/review) Map the gate decision to the exit code: GO/GO_WITH_OBSERVATION=0,
                    NO_GO=1, ESCALATE=3. Opt-in; combines with --fail-on/--warn-on (stricter wins).
                    Conflicts with --advisory-only.
  --offline         (run) Skip AI; review on deterministic heuristics only, even if an API key is set.
                    Reproduces the Auto-approve gate locally when CI/AI is unavailable. Alias: --rules-only

Commands:
  river runs list           List stored review runs
  river runs diff <id1> <id2> [<id3>...] Diff stored review runs (3+ runs detect oscillation)
  river runs summary        Show aggregate dashboard metrics
  river runs digest         Supervision digest (gate decisions, warnings, escape candidates)
  --cases <path>    (eval) Path to fixtures cases.json (default: tests/fixtures/review-eval/cases.json)
  --verbose         (eval) Print detailed per-case results
  -h, --help        Show this help message
`);
}

// #1709 Slice 2: one-line usage summaries per command, printed to stderr on a
// usage error instead of the full help text. The full help used to go to
// stdout on every option error, which polluted redirected artifacts (e.g.
// runners/github-action redirects stdout into the review JSON file).
const COMMAND_USAGE = {
  run: 'river run <path> [options]',
  doctor: 'river doctor <path> [options]',
  skills: 'river skills <path> | river skills <import|export|list|resolve> [options]',
  runs: 'river runs <list|diff|summary|digest> [options]',
  review: 'river review <plan|exec|verify|route> [options]',
  eval: 'river eval [--cases <path>] [--verbose]',
  feedback: 'river feedback add --type <type> --skill <id> [options]',
  suppression:
    'river suppression add --fingerprint <fp> --feedback <type> --rationale <text> [options]',
  promote:
    'river promote <propose|list|approve|reject|template|retire|review-effectiveness> [options]',
  evolve: 'river evolve <aggregate|replay> [options]',
};

const GENERIC_USAGE = 'river <command> <path> [options]';

function printUsageHint(command) {
  console.error(`Usage: ${COMMAND_USAGE[command] ?? GENERIC_USAGE}`);
  console.error('Run `river --help` for the full option list.');
}

/**
 * #1709 Slice 2 — central usage-error contract.
 *
 * Every option/command parse error funnels through here. The call site has
 * already written its `Error: ...` line to stderr; this helper appends a
 * one-line usage summary plus a pointer to the full help (both stderr) and
 * marks the parse result so `main()` exits 1 WITHOUT printing the full help
 * to stdout. Explicit `-h`/`--help` (and bare `river`) keep the old
 * contract: full help on stdout, exit 0.
 */
function usageError(parsed) {
  printUsageHint(parsed.command);
  parsed.usageError = true;
}

/**
 * Every option token `parseArgs` recognizes, used only by
 * `takeFreeTextValue()` below. Keep in sync when adding an option.
 */
const KNOWN_OPTION_TOKENS = new Set([
  // suppression
  '--fingerprint',
  '--finding',
  '--feedback',
  '--scope',
  '--rationale',
  '--severity',
  '--files',
  '--expires',
  '--pr',
  // skills resolve
  '--path',
  // feedback
  '--type',
  '--skill',
  '--trigger',
  '--evidence',
  '--reviewer',
  '--model',
  '--reversed-by',
  '--run-id',
  // promote
  '--approver',
  '--reason',
  '--index',
  '--include-inactive',
  '--threshold',
  '--feedback-root',
  '--input',
  '--cluster-key',
  '--policy-version',
  // evolve
  '--min',
  '--month',
  '--spec',
  '--expect-manifest',
  // shared / review
  '--plan-only',
  '--fail-on',
  '--warn-on',
  '--advisory-only',
  '--gate',
  '--offline',
  '--rules-only',
  '--plan',
  '--output-file',
  '--summary-file',
  '--quiet',
  '--artifacts-dir',
  '--artifact',
  '--ensemble',
  '--phase',
  '--cases',
  '--verbose',
  '--planner',
  '--dry-run',
  '--debug',
  '--explain',
  '--estimate',
  '--max-cost',
  '--output',
  '--format',
  '--context',
  '--dependency',
  '--reviewers',
  '--baseline',
  '--base',
  '--skill-set',
  '--depth',
  '--save',
  '--from',
  '--to',
  '--strict',
  '--loose',
  '--source',
  '--include-assets',
  '-h',
  '--help',
]);

/**
 * Value reader for options whose value is FREE TEXT a human writes
 * (`--rationale`, `--evidence`, `--reason`).
 *
 * The `!value || value.startsWith('-')` guard the other options use is correct
 * for paths, enums, ids and numbers, but it rejects legitimate prose: a
 * rationale such as `"-1 は誤検知"` was reported back as
 * "--rationale option requires a value", which is both a false rejection and a
 * misleading message. Free-text options therefore accept a leading `-`.
 *
 * The failure case that must STAY blocked is #1717: `--evidence --pr 123`
 * silently recorded `evidence: "--pr"` and dropped the pr. So "missing value"
 * here means "no next token, or the next token is an option this parser
 * recognizes" — prose is accepted, a real flag is not swallowed.
 *
 * @param {string[]} args - remaining argv (not consumed when the value is missing).
 * @returns {{ value: string } | { missing: true }}
 */
function takeFreeTextValue(args) {
  const next = args[0];
  if (next === undefined || KNOWN_OPTION_TOKENS.has(next) || next.startsWith('--run-id=')) {
    return { missing: true };
  }
  return { value: args.shift() };
}

function parseArgs(argv) {
  const args = [...argv];
  const SKILLS_SUBCOMMANDS = new Set(['import', 'export', 'list', 'resolve']);
  // #1574 P1 `aggregate` / P2 `replay`. Matching against a known set (rather
  // than "first non-flag token") keeps `river evolve <path>` working.
  const EVOLVE_SUBCOMMANDS = new Set(['aggregate', 'replay']);
  // Global options the shared parser below handles for `evolve`. Anything else
  // starting with `-` is rejected rather than silently ignored.
  const EVOLVE_SHARED_OPTIONS = new Set(['--output', '-h', '--help', '--debug']);
  // Same treatment for `promote`: a typo such as `--dry-rnu` must not fall
  // through to the shared parser and be ignored, because `propose` then writes
  // the index for real while the caller believes it asked for a dry run.
  const PROMOTE_SHARED_OPTIONS = new Set(['--output', '--dry-run', '-h', '--help', '--debug']);
  const parsed = {
    command: null,
    // #1709 Slice 2: set (via usageError) when an option/command parse error
    // was already reported to stderr; main() then exits 1 without help.
    usageError: false,
    target: '.',
    fixturesCasesPath: null,
    verbose: false,
    phase: process.env.RIVER_PHASE || 'midstream',
    plannerMode: process.env.RIVER_PLANNER_MODE || 'off',
    dryRun: false,
    debug: false,
    estimate: false,
    maxCost: null,
    output: 'text',
    outputExplicit: false,
    format: null,
    formatExplicit: false,
    availableContexts: null,
    availableDependencies: null,
    reviewers: null,
    baseline: null,
    base: null,
    skillSet: null,
    depth: null,
    save: false,
    // runs subcommand fields
    runsSubcommand: null,
    runsId1: null,
    runsId2: null,
    runsIds: [], // all run IDs for multi-run diff (3+)
    // suppression subcommand fields (#687 PR-D)
    suppressionSubcommand: null,
    feedbackSubcommand: null,
    feedbackType: null,
    feedbackSkillId: null,
    feedbackTrigger: null,
    feedbackFingerprint: null,
    feedbackEvidence: null,
    feedbackPrNumber: null,
    feedbackReviewer: null,
    feedbackModel: null,
    feedbackReversedBy: null,
    feedbackRunId: null,
    suppressionFingerprint: null,
    suppressionFindingId: null,
    suppressionFeedbackType: null,
    suppressionScope: 'file',
    suppressionRationale: null,
    suppressionSeverity: null,
    suppressionFiles: null,
    suppressionExpiresAt: null,
    suppressionPrNumber: null,
    // promote subcommand fields (#1622 / #1568-B)
    promoteSubcommand: null,
    promoteId: null,
    promoteApprover: null,
    promoteReason: null,
    promoteIndex: null,
    promoteIncludeInactive: false,
    promoteThreshold: null,
    promoteFeedbackRoot: null,
    // promote propose fields (#1624 / #1574 P0 contract 4)
    promoteInput: null,
    promoteClusterKey: null,
    promotePolicyVersion: null,
    promoteUnknownOption: null,
    // evolve subcommand fields (#1574 P1 Shadow aggregate / P2 Paired replay)
    evolveSubcommand: null,
    evolveMin: null,
    evolveMonth: null,
    evolveSpec: null,
    evolveExpectManifest: null,
    evolveExtraArgs: [],
    evolveUnknownOption: null,
    // skills subcommand fields
    skillsSubcommand: null,
    resolvePaths: null,
    fromPath: null,
    toPath: null,
    validationMode: 'strict',
    listSource: 'all',
    includeAssets: false,
    // review subcommand fields (#802 Phase 3)
    reviewSubcommand: null,
    planOnly: false,
    failOn: null,
    warnOn: null,
    advisoryOnly: false,
    gate: false,
    offline: false,
    outputFile: null,
    summaryFile: null,
    quiet: false,
    artifactsDir: null,
    cliArtifacts: {},
    planFile: null,
  };

  while (args.length) {
    const arg = args.shift();
    if (
      !parsed.command &&
      (arg === 'run' ||
        arg === 'doctor' ||
        arg === 'skills' ||
        arg === 'runs' ||
        arg === 'suppression' ||
        arg === 'feedback' ||
        arg === 'evolve' ||
        arg === 'promote')
    ) {
      parsed.command = arg;
      // Check for skills subcommands (import/export/list)
      if (arg === 'skills' && args[0] && SKILLS_SUBCOMMANDS.has(args[0])) {
        parsed.skillsSubcommand = args.shift();
      } else if (arg === 'evolve') {
        if (args[0] && EVOLVE_SUBCOMMANDS.has(args[0])) {
          parsed.evolveSubcommand = args.shift();
        }
        // `replay` takes NO positional: its dataset comes from --spec. Letting
        // the first token become `parsed.target` would make the command accept
        // and silently ignore it (`river evolve replay ./typo.json --spec x`).
        if (parsed.evolveSubcommand !== 'replay' && args[0] && !args[0].startsWith('-')) {
          const token = args.shift();
          // A mistyped subcommand (`agregate`) must not be swallowed as a path
          // and reported as an empty, successful aggregate. Anything that is
          // neither a known subcommand nor an existing path is an error.
          if (!parsed.evolveSubcommand && !existsSync(token)) {
            parsed.evolveSubcommand = token; // handler rejects it with exit 1
          } else {
            parsed.target = token;
          }
        }
        // Surplus positionals are a usage error, never silently discarded.
        while (args[0] && !args[0].startsWith('-')) {
          parsed.evolveExtraArgs.push(args.shift());
        }
      } else if (arg === 'runs' && args[0] && !args[0].startsWith('-')) {
        parsed.runsSubcommand = args.shift(); // list | diff | summary | digest
        // diff takes two or more positional run IDs
        if (parsed.runsSubcommand === 'diff') {
          parsed.runsId1 = args.shift() ?? null;
          parsed.runsId2 = args.shift() ?? null;
          // Collect any additional run IDs for multi-run oscillation detection
          const extra = [];
          while (args.length && !args[0].startsWith('-')) {
            extra.push(args.shift());
          }
          parsed.runsIds = [parsed.runsId1, parsed.runsId2, ...extra].filter(Boolean);
        }
      } else if (arg === 'suppression' && args[0] && !args[0].startsWith('-')) {
        parsed.suppressionSubcommand = args.shift(); // add (only one for now)
      } else if (arg === 'feedback' && args[0] && !args[0].startsWith('-')) {
        parsed.feedbackSubcommand = args.shift(); // add (only one for now)
      } else if (arg === 'promote' && args[0] && !args[0].startsWith('-')) {
        parsed.promoteSubcommand = args.shift(); // propose | list | approve | reject | template | retire | review-effectiveness
        // approve/reject/template/review-effectiveness take an optional positional candidate id.
        if (
          ['approve', 'reject', 'template', 'review-effectiveness'].includes(
            parsed.promoteSubcommand
          ) &&
          args[0] &&
          !args[0].startsWith('-')
        ) {
          parsed.promoteId = args.shift();
        }
      } else if (
        arg !== 'runs' &&
        arg !== 'suppression' &&
        arg !== 'feedback' &&
        arg !== 'promote' &&
        args[0] &&
        !args[0].startsWith('-')
      ) {
        parsed.target = args.shift();
      }
      continue;
    }
    if (parsed.command === 'suppression') {
      // #1709 Slice 3: every option below takes a value, and none of the
      // `args.shift() ?? <default>` forms guarded it. A trailing `--scope`
      // silently fell back to 'file' and a `--pr abc` was silently dropped —
      // in both cases the suppression entry was still WRITTEN with exit 0
      // (holes found by the Slice 2 adversarial review; pinned in the canary).
      // Same guard shape as the feedback options below (#1717).
      if (arg === '--fingerprint') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --fingerprint option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.suppressionFingerprint = value;
        continue;
      }
      if (arg === '--finding') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --finding option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.suppressionFindingId = value;
        continue;
      }
      if (arg === '--feedback') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --feedback option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.suppressionFeedbackType = value;
        continue;
      }
      if (arg === '--scope') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --scope option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.suppressionScope = value;
        continue;
      }
      if (arg === '--rationale') {
        // Free text (`--rationale "-1 は誤検知"` must be accepted).
        const taken = takeFreeTextValue(args);
        if (taken.missing) {
          console.error('Error: --rationale option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.suppressionRationale = taken.value;
        continue;
      }
      if (arg === '--severity') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --severity option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.suppressionSeverity = value;
        continue;
      }
      if (arg === '--files') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --files option requires a comma-separated list.');
          usageError(parsed);
          break;
        }
        parsed.suppressionFiles = parseList(value);
        continue;
      }
      if (arg === '--expires') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --expires option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.suppressionExpiresAt = value;
        continue;
      }
      if (arg === '--pr') {
        const value = args.shift();
        // Strict parse, same shape as the feedback --pr below: parseInt('abc')
        // used to become NaN and be dropped in silence while the entry was
        // still written with exit 0.
        if (!value || !/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
          console.error('Error: --pr option requires a positive integer.');
          usageError(parsed);
          break;
        }
        parsed.suppressionPrNumber = Number.parseInt(value, 10);
        continue;
      }
    }
    if (parsed.command === 'skills' && parsed.skillsSubcommand === 'resolve') {
      if (arg === '--path') {
        parsed.resolvePaths = parsed.resolvePaths ?? [];
        const v = args.shift();
        if (v) parsed.resolvePaths.push(v);
        continue;
      }
    }
    if (parsed.command === 'feedback') {
      // #1717: every option below takes a value, and `args.shift() ?? null`
      // guarded none of them. A missing value consumed the FOLLOWING flag as
      // this option's value (so `--pr --evidence x` lost both at once), and a
      // value that failed validation was dropped in silence while the entry was
      // still written. Each option now rejects a missing value / a following
      // flag up front with the same `!value || value.startsWith('-')` guard the
      // --reviewer / --model / --run-id options below already use. The
      // option-error convention itself (stderr message + help) is unchanged;
      // unifying its exit code is #1709.
      if (arg === '--type') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --type option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackType = value;
        continue;
      }
      if (arg === '--skill') {
        const value = args.shift();
        // `--skill --pr 123` used to record skillId:"--pr": a flag is a
        // non-empty string, so buildFeedbackEntry's "skillId is required."
        // check accepted it and wrote the entry.
        if (!value || value.startsWith('-')) {
          console.error('Error: --skill option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackSkillId = value;
        continue;
      }
      if (arg === '--trigger') {
        const value = args.shift();
        // A trailing `--trigger` used to null the field, which the handler maps
        // back to undefined — so the entry was written with the DEFAULT trigger
        // instead of the one the caller meant to set.
        if (!value || value.startsWith('-')) {
          console.error('Error: --trigger option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackTrigger = value;
        continue;
      }
      if (arg === '--fingerprint') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --fingerprint option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackFingerprint = value;
        continue;
      }
      if (arg === '--evidence') {
        // Free text. `--evidence --pr 123` (recording evidence:"--pr" and
        // dropping the pr, #1717) stays blocked because takeFreeTextValue
        // treats a recognized option token as a missing value.
        const taken = takeFreeTextValue(args);
        if (taken.missing) {
          console.error('Error: --evidence option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackEvidence = taken.value;
        continue;
      }
      if (arg === '--pr') {
        const value = args.shift();
        // Strict parse, same shape as --threshold (#1658): parseInt('12abc') is
        // 12 and parseInt('1.5') is 1, so a typo silently recorded a DIFFERENT
        // pr than the one that was typed, while 'abc' / 0 / -5 / a following
        // flag all became pr:null on an entry that was still written (exit 0).
        // `pr` is one half of the occurrence key (review_run_id, pr), so a null
        // or wrong value skews the repetition denominator downstream (#1717).
        if (!value || !/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
          console.error('Error: --pr option requires a positive integer.');
          usageError(parsed);
          break;
        }
        parsed.feedbackPrNumber = Number.parseInt(value, 10);
        continue;
      }
      if (arg === '--reviewer') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --reviewer option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackReviewer = value;
        continue;
      }
      if (arg === '--model') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --model option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackModel = value;
        continue;
      }
      if (arg === '--reversed-by') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --reversed-by option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackReversedBy = value;
        continue;
      }
      // #1673: the run this feedback refers to. Only an explicit id is
      // accepted — resolving "the latest run" implicitly would attach evidence
      // to an unrelated run.
      //
      // Two silent-miss paths this parse deliberately closes, both of which
      // exited 0 while writing an entry with no `review_run_id` (so the loss
      // only surfaced much later as joinedFeedbackCount staying at 0):
      //   1. `--run-id=<id>`: the token never equals '--run-id', so an
      //      equals-form value fell through and was dropped.
      //   2. `--run-id "   "`: whitespace passes a truthiness check, then
      //      normalizeOptionalString() nulls it out downstream.
      // The `=` form is scoped to THIS option on purpose; extending it to
      // --reviewer / --model / --reversed-by would change their behaviour and
      // is out of scope here.
      if (arg === '--run-id' || arg.startsWith('--run-id=')) {
        const value = arg.startsWith('--run-id=') ? arg.slice('--run-id='.length) : args.shift();
        if (!value || !value.trim() || value.startsWith('-')) {
          console.error('Error: --run-id option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.feedbackRunId = value;
        continue;
      }
    }
    if (parsed.command === 'promote') {
      if (arg === '--approver') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --approver option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.promoteApprover = value;
        continue;
      }
      if (arg === '--reason') {
        // Free text (approval / rejection prose written by a human).
        const taken = takeFreeTextValue(args);
        if (taken.missing) {
          console.error('Error: --reason option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.promoteReason = taken.value;
        continue;
      }
      if (arg === '--index') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --index option requires a path.');
          usageError(parsed);
          break;
        }
        parsed.promoteIndex = value;
        continue;
      }
      if (arg === '--include-inactive') {
        parsed.promoteIncludeInactive = true;
        continue;
      }
      if (arg === '--threshold') {
        const value = args.shift();
        // Strict parse: parseInt('2garbage') is 2, so a typo would silently
        // become a different threshold than the one that was typed.
        if (!value || !/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
          console.error('Error: --threshold option requires a positive integer.');
          usageError(parsed);
          break;
        }
        parsed.promoteThreshold = Number.parseInt(value, 10);
        continue;
      }
      if (arg === '--feedback-root') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --feedback-root option requires a path.');
          usageError(parsed);
          break;
        }
        parsed.promoteFeedbackRoot = value;
        continue;
      }
      if (arg === '--input') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --input option requires a JSONL path.');
          usageError(parsed);
          break;
        }
        parsed.promoteInput = value;
        continue;
      }
      if (arg === '--cluster-key') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --cluster-key option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.promoteClusterKey = value;
        continue;
      }
      if (arg === '--policy-version') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --policy-version option requires a value.');
          usageError(parsed);
          break;
        }
        parsed.promotePolicyVersion = value;
        continue;
      }
      // Options that are neither promote's own nor handled by the shared parser
      // must fail loudly instead of being ignored (a mistyped `--dry-rnu` would
      // otherwise write the Riverbed index for real).
      if (arg.startsWith('-') && !PROMOTE_SHARED_OPTIONS.has(arg)) {
        parsed.promoteUnknownOption = arg;
        break;
      }
    }
    if (parsed.command === 'evolve') {
      if (arg === '--min') {
        const value = args.shift();
        // Strict parse, same reason as promote's --threshold above.
        if (!value || !/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
          console.error('Error: --min option requires a positive integer.');
          usageError(parsed);
          break;
        }
        parsed.evolveMin = Number.parseInt(value, 10);
        continue;
      }
      if (arg === '--month') {
        const value = args.shift();
        if (!value || !/^\d{4}-\d{2}$/.test(value)) {
          console.error('Error: --month option requires a YYYY-MM value.');
          usageError(parsed);
          break;
        }
        parsed.evolveMonth = value;
        continue;
      }
      if (arg === '--spec') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --spec option requires a file path.');
          usageError(parsed);
          break;
        }
        parsed.evolveSpec = value;
        continue;
      }
      if (arg === '--expect-manifest') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --expect-manifest option requires a manifest id or hash.');
          usageError(parsed);
          break;
        }
        parsed.evolveExpectManifest = value;
        continue;
      }
      // Options that are not evolve's own and not handled by the shared parser
      // below must fail loudly instead of being ignored.
      if (arg.startsWith('-') && !EVOLVE_SHARED_OPTIONS.has(arg)) {
        parsed.evolveUnknownOption = arg;
        break;
      }
    }
    if (!parsed.command && arg === 'eval') {
      parsed.command = 'eval';
      continue;
    }
    if (!parsed.command && arg === 'review') {
      parsed.command = 'review';
      if (args[0] && !args[0].startsWith('-')) {
        parsed.reviewSubcommand = args.shift(); // plan | exec | verify
      }
      // Consume optional positional target path (e.g., `river review route .`)
      if (args[0] && !args[0].startsWith('-')) {
        parsed.target = args.shift();
      }
      continue;
    }
    // #1709 Slice 2 (B1): an unknown leading token used to fall through
    // silently, leaving `parsed.command` null — so main() printed the full
    // help and exited 0, and its `Unknown command:` branch was unreachable
    // dead code. Record the token as the command so that branch actually
    // fires (exit 1, error on stderr).
    if (!parsed.command && !arg.startsWith('-')) {
      parsed.command = arg;
      break;
    }
    if (arg === '--plan-only') {
      parsed.planOnly = true;
      continue;
    }
    if (arg === '--fail-on' || arg === '--warn-on') {
      const value = args.shift();
      const sev = value ? value.toLowerCase() : '';
      if (!['info', 'minor', 'major', 'critical'].includes(sev)) {
        console.error(
          `Error: ${arg} must be one of: info, minor, major, critical (got "${value ?? ''}").`
        );
        usageError(parsed);
        break;
      }
      if (arg === '--fail-on') parsed.failOn = sev;
      else parsed.warnOn = sev;
      continue;
    }
    if (arg === '--advisory-only') {
      parsed.advisoryOnly = true;
      continue;
    }
    if (arg === '--gate') {
      parsed.gate = true;
      continue;
    }
    if (arg === '--offline' || arg === '--rules-only') {
      parsed.offline = true;
      continue;
    }
    if (arg === '--plan') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --plan option requires a path.');
        usageError(parsed);
        break;
      }
      parsed.planFile = value;
      continue;
    }
    if (arg === '--output-file') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --output-file option requires a path.');
        usageError(parsed);
        break;
      }
      parsed.outputFile = value;
      continue;
    }
    if (arg === '--summary-file') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --summary-file option requires a path.');
        usageError(parsed);
        break;
      }
      parsed.summaryFile = value;
      continue;
    }
    if (arg === '--quiet') {
      parsed.quiet = true;
      continue;
    }
    if (arg === '--artifacts-dir') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --artifacts-dir option requires a path.');
        usageError(parsed);
        break;
      }
      parsed.artifactsDir = value;
      continue;
    }
    if (arg === '--artifact') {
      const value = args.shift();
      const eq = value ? value.indexOf('=') : -1;
      if (!value || value.startsWith('-') || eq <= 0) {
        console.error('Error: --artifact requires <id>=<path> (e.g. --artifact plan=./plan.md).');
        usageError(parsed);
        break;
      }
      parsed.cliArtifacts[value.slice(0, eq)] = value.slice(eq + 1);
      continue;
    }
    if (arg === '--ensemble') {
      // #911 Phase 3 Slice B. Sugar for "concatenate every *.md file under
      // <dir> into a single review-external artifact". The synthesis skill
      // (`independent-review-synthesis`) consumes the merged
      // file. We deliberately do NOT pin specific reviewer names (Claude /
      // Codex / Cursor) in the flag — file names carry that information, so
      // the CLI stays provider-agnostic.
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error(
          'Error: --ensemble requires a directory path (e.g. --ensemble ./.river/reviews).'
        );
        usageError(parsed);
        break;
      }
      if (parsed.cliArtifacts['review-external']) {
        console.warn(
          'Warning: --ensemble ignored because --artifact review-external=... is already set. Remove the --artifact flag or drop --ensemble.'
        );
        continue;
      }
      const dir = path.resolve(process.cwd(), value);
      let files;
      try {
        files = readdirSync(dir)
          .filter((f) => f.endsWith('.md'))
          .sort();
      } catch (err) {
        console.error(`Error: --ensemble cannot read directory ${value}: ${err.message}`);
        usageError(parsed);
        break;
      }
      if (files.length === 0) {
        console.error(`Error: --ensemble found no *.md files in ${value}.`);
        usageError(parsed);
        break;
      }
      const merged = files
        .map((f) => `\n\n---\nFrom: ${f}\n---\n\n${readFileSync(path.join(dir, f), 'utf8')}`)
        .join('');
      const tmpPath = path.join(os.tmpdir(), `river-ensemble-${process.pid}-${Date.now()}.md`);
      writeFileSync(tmpPath, merged);
      process.on('exit', () => {
        try {
          unlinkSync(tmpPath);
        } catch {
          // ignore cleanup errors — OS will reclaim tmpdir
        }
      });
      parsed.cliArtifacts['review-external'] = tmpPath;
      continue;
    }
    if (arg === '--phase') {
      if (!args[0] || args[0].startsWith('-')) {
        console.error('Error: --phase option requires a value.');
        usageError(parsed);
        break;
      }
      parsed.phase = args.shift();
      continue;
    }
    if (arg === '--cases') {
      const value = args.shift();
      // #1709 Slice 3 (B3): a trailing `--cases` used to null the field, so
      // eval silently fell back to the DEFAULT fixtures and printed [PASS].
      if (!value || value.startsWith('-')) {
        console.error('Error: --cases option requires a path.');
        usageError(parsed);
        break;
      }
      parsed.fixturesCasesPath = value;
      continue;
    }
    if (arg === '--verbose') {
      parsed.verbose = true;
      continue;
    }
    if (arg === '--planner') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --planner option requires a value.');
        usageError(parsed);
        break;
      }
      const mode = value.toLowerCase();
      if (!PLANNER_MODES.includes(mode)) {
        console.error(
          `Error: --planner must be one of: ${PLANNER_MODES.join(', ')} (got "${value}").`
        );
        usageError(parsed);
        break;
      }
      parsed.plannerMode = mode;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--debug') {
      parsed.debug = true;
      continue;
    }
    if (arg === '--explain') {
      parsed.explain = true;
      continue;
    }
    if (arg === '--estimate') {
      parsed.estimate = true;
      continue;
    }
    if (arg === '--max-cost') {
      const value = args.shift();
      parsed.maxCost = value ? Number.parseFloat(value) : null;
      if (!Number.isFinite(parsed.maxCost) || parsed.maxCost < 0) {
        console.error('Error: --max-cost requires a non-negative numeric value.');
        usageError(parsed);
        break;
      }
      continue;
    }
    if (arg === '--output') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --output option requires a value.');
        usageError(parsed);
        break;
      }
      const mode = value.toLowerCase();
      if (!['text', 'markdown', 'json', 'yaml', 'html'].includes(mode)) {
        console.error(
          `Error: --output must be one of: text, markdown, json, yaml, html (got "${value}").`
        );
        usageError(parsed);
        break;
      }
      parsed.output = mode;
      parsed.outputExplicit = true;
      continue;
    }
    if (arg === '--format') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --format option requires a value.');
        usageError(parsed);
        break;
      }
      const mode = value.toLowerCase();
      if (!['text', 'markdown', 'json'].includes(mode)) {
        console.error(`Error: --format must be one of: text, markdown, json (got "${value}").`);
        usageError(parsed);
        break;
      }
      parsed.format = mode;
      parsed.formatExplicit = true;
      continue;
    }
    if (arg === '--context') {
      const value = args.shift();
      // #1709 Slice 3: a trailing `--context` used to become parseList(undefined)
      // = [] in silence (same for --dependency below).
      if (!value || value.startsWith('-')) {
        console.error('Error: --context option requires a comma-separated list.');
        usageError(parsed);
        break;
      }
      parsed.availableContexts = parseList(value);
      continue;
    }
    if (arg === '--dependency') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --dependency option requires a comma-separated list.');
        usageError(parsed);
        break;
      }
      parsed.availableDependencies = parseList(value);
      continue;
    }
    if (arg === '--reviewers') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error(
          'Error: --reviewers option requires a value (e.g. bug-hunter,security-scanner).'
        );
        usageError(parsed);
        break;
      }
      parsed.reviewers = parseList(value);
      continue;
    }
    if (arg === '--baseline') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --baseline option requires a file path.');
        usageError(parsed);
        break;
      }
      parsed.baseline = value;
      continue;
    }
    if (arg === '--base') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --base option requires a branch or ref (e.g. --base main).');
        usageError(parsed);
        break;
      }
      parsed.base = value;
      continue;
    }
    if (arg === '--skill-set') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error(
          'Error: --skill-set option requires a name (e.g. --skill-set comprehensive).'
        );
        usageError(parsed);
        break;
      }
      parsed.skillSet = value;
      continue;
    }
    if (arg === '--depth') {
      const value = args.shift();
      const valid = Object.keys(DEPTH_TO_REVIEW_MODE);
      if (!value || !valid.includes(value)) {
        console.error(`Error: --depth must be one of: ${valid.join(', ')} (got "${value ?? ''}").`);
        usageError(parsed);
        break;
      }
      parsed.depth = value;
      continue;
    }
    if (arg === '--save') {
      parsed.save = true;
      continue;
    }
    // Skills subcommand options
    if (arg === '--from') {
      const value = args.shift();
      // #1709 Slice 3: a trailing `--from` / `--to` used to null the field in
      // silence, so `skills import --from` ran against the default instead.
      if (!value || value.startsWith('-')) {
        console.error('Error: --from option requires a path.');
        usageError(parsed);
        break;
      }
      parsed.fromPath = value;
      continue;
    }
    if (arg === '--to') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --to option requires a path.');
        usageError(parsed);
        break;
      }
      parsed.toPath = value;
      continue;
    }
    if (arg === '--strict') {
      parsed.validationMode = 'strict';
      continue;
    }
    if (arg === '--loose') {
      parsed.validationMode = 'loose';
      continue;
    }
    if (arg === '--source') {
      const value = args.shift();
      if (!value || !['rr', 'agent', 'all'].includes(value)) {
        console.error(`Error: --source must be one of: rr, agent, all (got "${value}").`);
        usageError(parsed);
        break;
      }
      parsed.listSource = value;
      continue;
    }
    if (arg === '--include-assets') {
      parsed.includeAssets = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      parsed.command = 'help';
      break;
    }
    // #1709 Slice 3: strict parse. A token that reaches this point matched no
    // rule above. It used to be ignored in silence (exit 0), so a typo like
    // `--dry-runn` ran the command as if the flag had not been given, and a
    // surplus positional was dropped without a trace. Note: promote / evolve
    // detect their own unknown options above (promoteUnknownOption /
    // evolveUnknownOption) and keep their handler-level messages.
    if (arg.startsWith('-')) {
      console.error(`Error: unknown option ${arg}.`);
    } else {
      console.error(`Error: unexpected argument "${arg}".`);
    }
    usageError(parsed);
    break;
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  // #1709 Slice 2: parseArgs already reported the usage error to stderr
  // (Error line + usage hint). Exit 1 without printing the full help to
  // stdout — usage errors must not pollute redirected stdout artifacts.
  if (parsed.usageError) {
    return 1;
  }
  if (parsed.command === 'help' || !parsed.command) {
    printHelp();
    return 0;
  }
  // Epic #1347 S4 (#1351): `--gate` enforces the gate decision as an exit code;
  // `--advisory-only` forces exit 0. They are contradictory — fail loudly
  // (exit 1) rather than silently letting one win.
  if (parsed.gate && parsed.advisoryOnly) {
    console.error('Error: --gate cannot be combined with --advisory-only (contradictory).');
    return 1;
  }
  // The replay path (`review exec --plan <file>`) deliberately omits the gate
  // block — a replayed artifact's risk-map / diff context is not this run's
  // (see review-plan.mjs finalizeArtifact). So --gate on replay could only ever
  // fail-safe to exit 1; reject it explicitly rather than always exiting 1.
  if (parsed.gate && typeof parsed.planFile === 'string') {
    console.error(
      'Error: --gate is not supported with --plan (the replay path does not derive an authoritative gate).'
    );
    return 1;
  }
  // Offline (rules-only) mode: force-disable AI for this process so the review
  // runs on deterministic heuristics only (ADR-002 / #1071). isLlmEnabled()
  // honors RIVER_OFFLINE across all call sites (dispatcher / runner / engine).
  if (parsed.offline) {
    process.env.RIVER_OFFLINE = '1';
  }
  if (
    ![
      'run',
      'doctor',
      'eval',
      'skills',
      'runs',
      'suppression',
      'feedback',
      'review',
      'promote',
      'evolve',
    ].includes(parsed.command)
  ) {
    // Reachable since #1709 Slice 2: parseArgs records an unknown leading
    // token as the command instead of silently leaving it null (which used
    // to print the full help and exit 0).
    console.error(`Unknown command: ${parsed.command}`);
    printUsageHint(parsed.command);
    return 1;
  }

  // review subcommand (#802 Phase 3) — no git repo required; pure
  // config + artifact resolution. Only `review plan --plan-only` is
  // wired in this slice.
  if (parsed.command === 'review') {
    return runReviewCommand(parsed);
  }

  const targetPath = path.resolve(parsed.target);

  try {
    // Skills subcommands (import/export/list) – no git repo required.
    // `return await` (not bare `return`) is required so a rejected handler
    // promise is caught by this function's outer try/catch, which maps
    // GitRepoNotFoundError / SkillLoaderError / ProjectRulesError /
    // RiskMapError / GitError to friendly messages + Hints. A bare `return`
    // settles the promise outside the try, regressing to a raw stack trace /
    // unhandledRejection (adversarial review BLOCKER, PR #1592).
    if (parsed.command === 'skills') {
      return await runSkillsCommand(parsed, targetPath);
    }

    if (parsed.command === 'suppression') {
      return await runSuppressionCommand(parsed, targetPath);
    }

    if (parsed.command === 'feedback') {
      return await runFeedbackCommand(parsed, targetPath);
    }

    // `return await` (not bare `return`) so a rejected handler promise is caught
    // by this outer try/catch for GitRepoNotFoundError etc. (adversarial review
    // BLOCKER lesson, PR #1592).
    if (parsed.command === 'promote') {
      return await runPromoteCommand(parsed, targetPath);
    }

    if (parsed.command === 'runs') {
      return await runRunsCommand(parsed, targetPath);
    }

    // `return await` so a rejected handler promise reaches this outer
    // try/catch (same reason as the promote/runs handlers above).
    if (parsed.command === 'evolve') {
      return await runEvolveCommand(parsed, targetPath);
    }

    if (parsed.command === 'eval') {
      return await runEvalCommand(parsed);
    }
    if (parsed.command === 'doctor') {
      return await runDoctorCommand(parsed, targetPath);
    }

    if (parsed.command === 'run') {
      return await runRunCommand(parsed, targetPath);
    }

    return 0;
  } catch (error) {
    if (error instanceof GitRepoNotFoundError) {
      console.error(error.message);
      printHintLines([
        'Run this command inside a git repository (or pass the repo path).',
        'If needed: `git init` or `git clone ...`',
      ]);
    } else if (error instanceof SkillLoaderError) {
      console.error(`Skill configuration error: ${error.message}`);
      printHintLines([
        'Run `npm run skills:validate` to see full validation errors.',
        'Docs: pages/guides/validate-skill-schema.md',
      ]);
    } else if (error instanceof ProjectRulesError) {
      console.error(error.message);
      printHintLines([
        'Check `.river/rules.md` exists and is readable (or remove it to disable rules).',
        'Docs: README.md (Project-specific review rules)',
      ]);
    } else if (error instanceof RiskMapError) {
      console.error(error.message);
      printHintLines([
        'Check `.river/risk-map.yaml` format and valid action values.',
        'Valid actions: comment_only, escalate, require_human_review',
      ]);
    } else if (error instanceof GitError) {
      console.error(`Git command failed: ${error.message}`);
      printHintLines([
        'Ensure `git` is available and the repository has a default branch.',
        'Try `river run . --debug` for more context.',
      ]);
    } else {
      console.error(`CLI error: ${error.message}`);
      printHintLines(['Try `river run . --debug` for more context.']);
    }
    return 1;
  }
}

export { parseArgs, main, isLlmlessEmptyReview, printExplain, validateOutputArtifact };

/**
 * この CLI が直接起動されたときのみ `main()` を実行する。
 *
 * `import.meta.url === \`file://${process.argv[1]}\`` という素朴な比較は、
 * 以下のケースで偽になり自動起動が走らない:
 *
 *   1. npm `bin` 経由（`npm install -g`）: `process.argv[1]` が symlink の
 *      `.../node_modules/.bin/river` のままで、`import.meta.url` は実体の
 *      `.../src/cli.mjs` を指す。
 *   2. macOS の `/tmp` → `/private/tmp` など、プラットフォーム固有の
 *      canonical path 展開。
 *   3. Windows のバックスラッシュ区切り path（`file:///C:/...` 形式でない）。
 *
 * そのため `realpathSync` で symlink を解決し、`pathToFileURL` で URL に
 * 変換した上で比較する。比較に失敗してもアプリは落とさない（import-only
 * シナリオを壊さない）。
 */
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    const real = realpathSync(process.argv[1]);
    return fileURLToPath(import.meta.url) === real || import.meta.url === pathToFileURL(real).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().then((code) => {
    if (typeof code === 'number' && code !== 0) {
      process.exitCode = code;
    }
  });
}
