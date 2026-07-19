#!/usr/bin/env node
import { realpathSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
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
  doctor <path>         Check setup and print hints for common issues
  review plan           Resolve upstream artifacts and emit a Review Artifact
                        (Phase 3 slice: --plan-only only)
  eval                  Run review fixtures evaluation (must_include checks)
  suppression add       Create a Riverbed Memory suppression entry
                        (--fingerprint --feedback --rationale [--scope]
                         [--severity] [--files] [--expires] [--pr])

Skills Subcommand Options:
  --from <path>         (import) Source directory to scan for SKILL.md files
  --to <path>           (import) Output dir for converted skills / (export) Output dir for SKILL.md
  --strict              (import) Require full RR schema compliance (default)
  --loose               (import) Accept minimal name/description, auto-fill missing fields
  --source <type>       (list) Filter: rr|agent|all (default: all)
  --include-assets      (export) Copy references/ scripts/ prompt/ alongside SKILL.md
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

function parseArgs(argv) {
  const args = [...argv];
  const SKILLS_SUBCOMMANDS = new Set(['import', 'export', 'list', 'resolve']);
  const parsed = {
    command: null,
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
    suppressionFingerprint: null,
    suppressionFindingId: null,
    suppressionFeedbackType: null,
    suppressionScope: 'file',
    suppressionRationale: null,
    suppressionSeverity: null,
    suppressionFiles: null,
    suppressionExpiresAt: null,
    suppressionPrNumber: null,
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
        arg === 'feedback')
    ) {
      parsed.command = arg;
      // Check for skills subcommands (import/export/list)
      if (arg === 'skills' && args[0] && SKILLS_SUBCOMMANDS.has(args[0])) {
        parsed.skillsSubcommand = args.shift();
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
      } else if (
        arg !== 'runs' &&
        arg !== 'suppression' &&
        arg !== 'feedback' &&
        args[0] &&
        !args[0].startsWith('-')
      ) {
        parsed.target = args.shift();
      }
      continue;
    }
    if (parsed.command === 'suppression') {
      if (arg === '--fingerprint') {
        parsed.suppressionFingerprint = args.shift() ?? null;
        continue;
      }
      if (arg === '--finding') {
        parsed.suppressionFindingId = args.shift() ?? null;
        continue;
      }
      if (arg === '--feedback') {
        parsed.suppressionFeedbackType = args.shift() ?? null;
        continue;
      }
      if (arg === '--scope') {
        parsed.suppressionScope = args.shift() ?? 'file';
        continue;
      }
      if (arg === '--rationale') {
        parsed.suppressionRationale = args.shift() ?? null;
        continue;
      }
      if (arg === '--severity') {
        parsed.suppressionSeverity = args.shift() ?? null;
        continue;
      }
      if (arg === '--files') {
        parsed.suppressionFiles = parseList(args.shift() ?? '');
        continue;
      }
      if (arg === '--expires') {
        parsed.suppressionExpiresAt = args.shift() ?? null;
        continue;
      }
      if (arg === '--pr') {
        const v = parseInt(args.shift() ?? '', 10);
        if (!Number.isNaN(v) && v > 0) parsed.suppressionPrNumber = v;
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
      if (arg === '--type') {
        parsed.feedbackType = args.shift() ?? null;
        continue;
      }
      if (arg === '--skill') {
        parsed.feedbackSkillId = args.shift() ?? null;
        continue;
      }
      if (arg === '--trigger') {
        parsed.feedbackTrigger = args.shift() ?? null;
        continue;
      }
      if (arg === '--fingerprint') {
        parsed.feedbackFingerprint = args.shift() ?? null;
        continue;
      }
      if (arg === '--evidence') {
        parsed.feedbackEvidence = args.shift() ?? null;
        continue;
      }
      if (arg === '--pr') {
        const v = parseInt(args.shift() ?? '', 10);
        if (!Number.isNaN(v) && v > 0) parsed.feedbackPrNumber = v;
        continue;
      }
      if (arg === '--reviewer') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --reviewer option requires a value.');
          parsed.command = 'help';
          break;
        }
        parsed.feedbackReviewer = value;
        continue;
      }
      if (arg === '--model') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --model option requires a value.');
          parsed.command = 'help';
          break;
        }
        parsed.feedbackModel = value;
        continue;
      }
      if (arg === '--reversed-by') {
        const value = args.shift();
        if (!value || value.startsWith('-')) {
          console.error('Error: --reversed-by option requires a value.');
          parsed.command = 'help';
          break;
        }
        parsed.feedbackReversedBy = value;
        continue;
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
        parsed.command = 'help';
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
        parsed.command = 'help';
        break;
      }
      parsed.planFile = value;
      continue;
    }
    if (arg === '--output-file') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --output-file option requires a path.');
        parsed.command = 'help';
        break;
      }
      parsed.outputFile = value;
      continue;
    }
    if (arg === '--summary-file') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --summary-file option requires a path.');
        parsed.command = 'help';
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
        parsed.command = 'help';
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
        parsed.command = 'help';
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
        parsed.command = 'help';
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
        parsed.command = 'help';
        break;
      }
      if (files.length === 0) {
        console.error(`Error: --ensemble found no *.md files in ${value}.`);
        parsed.command = 'help';
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
        parsed.command = 'help';
        break;
      }
      parsed.phase = args.shift();
      continue;
    }
    if (arg === '--cases') {
      parsed.fixturesCasesPath = args.shift() ?? null;
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
        parsed.command = 'help';
        break;
      }
      const mode = value.toLowerCase();
      if (!PLANNER_MODES.includes(mode)) {
        console.error(
          `Error: --planner must be one of: ${PLANNER_MODES.join(', ')} (got "${value}").`
        );
        parsed.command = 'help';
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
        parsed.command = 'help';
        break;
      }
      continue;
    }
    if (arg === '--output') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --output option requires a value.');
        parsed.command = 'help';
        break;
      }
      const mode = value.toLowerCase();
      if (!['text', 'markdown', 'json', 'yaml', 'html'].includes(mode)) {
        console.error(
          `Error: --output must be one of: text, markdown, json, yaml, html (got "${value}").`
        );
        parsed.command = 'help';
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
        parsed.command = 'help';
        break;
      }
      const mode = value.toLowerCase();
      if (!['text', 'markdown', 'json'].includes(mode)) {
        console.error(`Error: --format must be one of: text, markdown, json (got "${value}").`);
        parsed.command = 'help';
        break;
      }
      parsed.format = mode;
      parsed.formatExplicit = true;
      continue;
    }
    if (arg === '--context') {
      parsed.availableContexts = parseList(args.shift());
      continue;
    }
    if (arg === '--dependency') {
      parsed.availableDependencies = parseList(args.shift());
      continue;
    }
    if (arg === '--reviewers') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error(
          'Error: --reviewers option requires a value (e.g. bug-hunter,security-scanner).'
        );
        parsed.command = 'help';
        break;
      }
      parsed.reviewers = parseList(value);
      continue;
    }
    if (arg === '--baseline') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --baseline option requires a file path.');
        parsed.command = 'help';
        break;
      }
      parsed.baseline = value;
      continue;
    }
    if (arg === '--base') {
      const value = args.shift();
      if (!value || value.startsWith('-')) {
        console.error('Error: --base option requires a branch or ref (e.g. --base main).');
        parsed.command = 'help';
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
        parsed.command = 'help';
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
        parsed.command = 'help';
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
      parsed.fromPath = args.shift() ?? null;
      continue;
    }
    if (arg === '--to') {
      parsed.toPath = args.shift() ?? null;
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
        parsed.command = 'help';
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
  }

  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
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
    !['run', 'doctor', 'eval', 'skills', 'runs', 'suppression', 'feedback', 'review'].includes(
      parsed.command
    )
  ) {
    console.error(`Unknown command: ${parsed.command}`);
    printHelp();
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

    if (parsed.command === 'runs') {
      return await runRunsCommand(parsed, targetPath);
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
