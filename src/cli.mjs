#!/usr/bin/env node
import { realpathSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  GitError,
  GitRepoNotFoundError,
  ensureGitRepo,
  detectDefaultBranch,
  findMergeBase,
} from './lib/git.mjs';
import { doctorLocalReview, planLocalReview, runLocalReview } from './lib/local-runner.mjs';
import { SkillLoaderError, resolveSkillSet } from '../runners/core/skill-loader.mjs';
import { collectRepoDiff, renderDiffText } from './lib/diff-processor.mjs';
import CostEstimator from './core/cost-estimator.mjs';
import { SkillDispatcher } from './core/skill-dispatcher.mjs';
import { ProjectRulesError } from './lib/rules.mjs';
import { RiskMapError } from './lib/risk-map.mjs';
import { isLlmEnabled, parseList } from './lib/utils.mjs';
import { PLANNER_MODES } from './lib/planner-utils.mjs';
import { DEPTH_TO_REVIEW_MODE, resolveDepthToReviewMode } from './lib/review-plan-generator.mjs';
import { resolveVerdict, scoreReview } from './lib/scoring/engine.mjs';
import { deriveRunGate } from './lib/run-gate.mjs';
import { AXES, AXIS_LABELS_JA } from './lib/scoring/rubric.mjs';
import { severityToPriority } from './lib/finding-factory.mjs';
import { deriveLoopSignalFromRunsDiff } from './lib/loop-signal.mjs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { runReviewCommand } from './cli/commands/review.mjs';

const MAX_PROMPT_PREVIEW_LENGTH = 800;
const MAX_RAW_LLM_OUTPUT_PREVIEW_LENGTH = 1500;
const MAX_DIFF_PREVIEW_LINES = 200;
const COMMENT_MARKER = '<!-- river-review -->';

function printHintLines(lines = []) {
  const hints = lines.filter(Boolean);
  if (!hints.length) return;
  console.error('\nHints:');
  hints.forEach((line) => console.error(`- ${line}`));
}

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

function formatPlan(plan) {
  // Defensive defaults: a plan may arrive without selected/skipped (e.g. an
  // empty `{}` from `--explain` when no plan was computed). Never throw.
  const selected = (plan?.selected ?? []).map((skill) => skill.metadata?.id ?? skill.id);
  const skipped = (plan?.skipped ?? []).map((item) => ({
    id: item.skill?.metadata?.id ?? item.skill?.id,
    reasons: item.reasons ?? [],
  }));
  const reasonCounts = skipped.reduce((acc, item) => {
    (item.reasons || []).forEach((reason) => {
      acc.set(reason, (acc.get(reason) ?? 0) + 1);
    });
    return acc;
  }, new Map());
  return { selected, skipped, reasonCounts };
}

function printPlan(plan) {
  const summary = formatPlan(plan);
  if (summary.selected.length) {
    console.log(`Selected skills (${summary.selected.length}): ${summary.selected.join(', ')}`);
  } else {
    console.log('Selected skills (0): none matched this diff');
  }
  if (summary.skipped.length) {
    console.log('Skipped skills:');
    summary.skipped.forEach((item) => {
      console.log(`- ${item.id}: ${item.reasons.join('; ')}`);
    });
    if (summary.reasonCounts.size) {
      console.log('Skip reasons summary:');
      for (const [reason, count] of summary.reasonCounts.entries()) {
        console.log(`- ${reason}: ${count}`);
      }
    }
  }
}

function printComments(comments) {
  if (!comments.length) {
    console.log('No review comments generated.');
    return;
  }
  console.log('Review comments:');
  comments.forEach((comment) => {
    console.log(`- ${comment.file}:${comment.line}: ${comment.message}`);
  });
}

function formatMessageForMarkdown(message) {
  const labels = ['Finding', 'Evidence', 'Impact', 'Fix', 'Severity', 'Confidence'];
  let result = message;
  for (const label of labels) {
    result = result.replace(new RegExp(`\\s*${label}:`, 'g'), `\n  - **${label}:**`);
  }
  return result;
}

function groupCommentsBySkill(comments) {
  return (comments ?? []).reduce((groups, comment) => {
    const key = comment.skillId || '';
    (groups[key] = groups[key] || []).push(comment);
    return groups;
  }, {});
}

/**
 * Markdown インジェクション対策: 特殊文字をエスケープ
 */
function sanitizeForMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&')
    .replace(/\n/g, ' ');
}

function formatCommentsMarkdown(comments) {
  if (!comments?.length) return '_No findings._';

  // スキル単位でグループ化
  const bySkill = groupCommentsBySkill(comments);
  const entries = Object.entries(bySkill);

  // スキルIDがないグループのみの場合は従来形式
  if (entries.length === 1 && entries[0][0] === '') {
    return comments
      .map((c) => `- \`${c.file}:${c.line}\`${formatMessageForMarkdown(c.message)}`)
      .join('\n');
  }

  // skillId でソートして出力順序を安定化
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  // スキル単位でセクション化
  return entries
    .map(([skillId, items]) => {
      // skillId をサニタイズして Markdown インジェクションを防止
      const safeSkillId = sanitizeForMarkdown(skillId);
      const header = skillId ? `#### 🔍 ${safeSkillId}` : '#### その他';
      const body = items
        .map((c) => `- \`${c.file}:${c.line}\`${formatMessageForMarkdown(c.message)}`)
        .join('\n');
      return `${header}\n${body}`;
    })
    .join('\n\n');
}

function formatPlanMarkdown(plan) {
  const summary = formatPlan(plan);
  const selected = summary.selected.length
    ? summary.selected.map((id) => `- \`${id}\``).join('\n')
    : '- _none_';

  if (!summary.skipped.length) {
    return `### 選択されたスキル (${summary.selected.length})\n${selected}\n`;
  }

  const skippedLines = summary.skipped
    .map((item) => `- \`${item.id}\`: ${item.reasons.join('; ')}`)
    .join('\n');
  return `### 選択されたスキル (${summary.selected.length})\n${selected}\n\n<details>\n<summary>スキップされたスキル (${summary.skipped.length})</summary>\n\n${skippedLines}\n\n</details>\n`;
}

function formatDebugSummaryMarkdown(result) {
  const debug = result.reviewDebug ?? {};
  const llmStatus = debug.llmUsed
    ? `used (\`${debug.llmModel}\`)`
    : debug.llmSkipped || debug.llmError
      ? `skipped (${debug.llmSkipped || debug.llmError})`
      : 'not used';

  const plan = result.plan ?? {};
  const plannerStatus = formatPlannerStatus(plan, { markdown: true });
  const impactTags = Array.isArray(plan?.impactTags) ? plan.impactTags : [];
  const impactSummary = impactTags.length ? impactTags.map((t) => `\`${t}\``).join(', ') : '`none`';

  return [
    `- LLM: ${llmStatus}`,
    `- Planner: ${plannerStatus}`,
    `- Impact tags: ${impactSummary}`,
    `- 変更ファイル数: ${result.changedFiles.length}`,
    `- トークン見積もり: ${result.tokenEstimate}`,
  ].join('\n');
}

function formatPlannerStatus(plan, { markdown = false } = {}) {
  const wrap = (value) => (markdown ? `\`${value}\`` : value);
  const requested = Boolean(plan?.plannerRequested);
  const mode = plan?.plannerMode || 'off';
  if (!requested || mode === 'off') return wrap('off');
  if (plan?.plannerSkipped) return `${wrap(mode)} skipped (${plan.plannerSkipped})`;
  if (plan?.plannerFallback) {
    const reason = plan?.plannerError || '';
    return reason ? `${wrap(mode)} fallback (${reason})` : `${wrap(mode)} fallback`;
  }
  return plan?.plannerUsed ? `${wrap(mode)} used` : `${wrap(mode)} not used`;
}

function logPreview(title, text, maxLength, log, { leadingNewline = false } = {}) {
  if (!text) return;
  const preview = text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  const prefix = leadingNewline ? '\n' : '';
  log(`${prefix}${title}:`);
  log(preview);
}

function formatRiskSummaryMarkdown(plan) {
  const risk = plan?.riskAssessment;
  if (!risk) return '';
  const badge =
    risk.aggregateAction === 'require_human_review'
      ? '🔴 require_human_review'
      : risk.aggregateAction === 'escalate'
        ? '🟡 escalate'
        : '🟢 comment_only';
  const lines = ['### リスク評価\n', '**判定**: ' + badge + '\n'];
  if (risk.humanReviewFiles?.length) {
    lines.push('**人間レビュー必須**:');
    for (const f of risk.humanReviewFiles) lines.push('- ' + sanitizeForMarkdown(f));
    lines.push('');
  }
  if (risk.escalatedFiles?.length) {
    lines.push('**エスカレーション対象**:');
    for (const f of risk.escalatedFiles) lines.push('- ' + sanitizeForMarkdown(f));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * #1067: true when no LLM key is configured (LLM review skipped) AND there are
 * no static findings — i.e. the run would otherwise post a value-less boilerplate
 * PR comment (skipped-skills list / impact tags / token estimate). Used to emit a
 * single concise note instead.
 */
function isLlmlessEmptyReview(result) {
  const debug = result?.reviewDebug ?? {};
  const llmKeyMissing = typeof debug.llmSkipped === 'string' && /not set/i.test(debug.llmSkipped);
  const noFindings = (result?.comments?.length ?? 0) === 0;
  return llmKeyMissing && noFindings;
}

function printMarkdownReport(result, phase) {
  if (isLlmlessEmptyReview(result)) {
    console.log(
      `${COMMENT_MARKER}
## River Review

- フェーズ: \`${phase}\`
- LLM レビュー未設定（\`ANTHROPIC_API_KEY\` / \`OPENAI_API_KEY\` / \`GOOGLE_API_KEY\` のいずれも未設定）のため静的チェックのみ実行し、**指摘はありません**。いずれか 1 つを設定すると LLM レビューが有効になり、リポジトリ固有の規約・差分スコープ等の観点でレビューします。`
    );
    return;
  }
  const header = `${COMMENT_MARKER}
## River Review

- フェーズ: \`${phase}\`
${formatDebugSummaryMarkdown(result)}
`;
  const planSection = formatPlanMarkdown(result.plan);
  const riskSection = formatRiskSummaryMarkdown(result.plan);
  const prioritySummary = formatPrioritySummaryMarkdown(result);
  const scoreSection = formatScoreSectionMarkdown(result, phase);
  const findings = `### 指摘\n${formatCommentsMarkdown(result.comments)}\n`;
  const suppressedSummary = formatSuppressedSummaryMarkdown(result.classified);
  console.log(
    [header, planSection, riskSection, prioritySummary, scoreSection, findings, suppressedSummary]
      .filter(Boolean)
      .join('\n')
  );
}

function formatSuppressedSummaryMarkdown(classified) {
  if (!classified?.suppressed?.length) return null;
  const counts = {};
  for (const f of classified.suppressed) {
    counts[f.suppressReason] = (counts[f.suppressReason] ?? 0) + 1;
  }
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r, n]) => `${r}(${n})`)
    .join(', ');
  return `> _${classified.suppressed.length} 件の指摘を抑制しました (主な理由: ${top})_\n`;
}

function formatPrioritySummaryMarkdown(result) {
  const findings = result.findings ?? [];
  const counts = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const f of findings) {
    const p = severityToPriority(f.severity);
    counts[p]++;
  }

  const lines = ['### 優先度サマリー\n'];

  if (counts.P1 > 0) {
    lines.push(`> **P1 (マージ前必須修正): ${counts.P1} 件**\n`);
  }

  lines.push(
    `- P1 (must fix before merge): ${counts.P1} 件`,
    `- P2 (should fix or waive): ${counts.P2} 件`,
    `- P3 (recommended improvement): ${counts.P3} 件`,
    `- P4 (informational): ${counts.P4} 件`,
    ''
  );

  const suppressed = result.classified?.suppressed ?? [];
  if (suppressed.length > 0) {
    const reasonCounts = {};
    for (const f of suppressed) {
      reasonCounts[f.suppressReason] = (reasonCounts[f.suppressReason] ?? 0) + 1;
    }
    const topReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r, n]) => `${r}(${n})`)
      .join(', ');
    lines.push(`- 抑制済み: ${suppressed.length} 件 (主な理由: ${topReasons})`, '');
  }

  const humanReviewFiles = result.plan?.riskMap?.require_human_review ?? [];
  if (humanReviewFiles.length > 0) {
    lines.push('> **Human review required**');
    for (const f of humanReviewFiles) lines.push(`> - ${sanitizeForMarkdown(f)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatScoreSectionMarkdown(result, phase) {
  const artifact = formatJsonOutput(result, phase);
  const score = scoreReview(artifact.issues ?? []);
  // formatJsonOutput already resolved the canonical verdict; reuse it so the
  // Markdown score section cannot drift from JSON/YAML/HTML (#1170 F3).
  score.verdict = resolveVerdict(artifact.decision, score.verdict);
  const lines = ['### スコア (参考値)'];
  lines.push('');
  lines.push(`結果(スコア): **${score.overall}/100**`);
  lines.push(`判定: **${score.verdict}**`);
  lines.push('');
  lines.push('内訳:');
  for (const axis of AXES) {
    lines.push(`- ${AXIS_LABELS_JA[axis]}: ${score.axes[axis]}/100`);
  }
  lines.push('');
  lines.push(
    '> スコアは severity と axis から決定論的に算出された **参考値** (`derived: true`)。HITL レビューと併用してください。'
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * #1045 A3 (#1141): human-readable explanation of which skills / gates / config
 * tier were resolved for this run. A focused alias over the same deterministic
 * resolution the planner already computed — printed to stderr so it never
 * corrupts machine-readable stdout (json / yaml).
 */
function printExplain(result, { log = console.error } = {}) {
  const summary = formatPlan(result?.plan ?? {});
  log('\nResolution (--explain):');

  // Config tier that won (CLI > repo-local > global > built-in default).
  const sourceLabel =
    result?.configSource === 'file'
      ? 'repository-local'
      : result?.configSource === 'global'
        ? 'user-global'
        : 'built-in default';
  log(`- Config: ${sourceLabel}${result?.configPath ? ` (${result.configPath})` : ''}`);

  // Skill / gate resolution.
  log(
    `- Planner: ${formatPlannerStatus(result?.plan ?? {})}` +
      (result?.manualReviewMode ? ` / review mode: ${result.manualReviewMode}` : '')
  );
  if (summary.selected.length) {
    log(`- Selected skills (${summary.selected.length}): ${summary.selected.join(', ')}`);
  } else {
    log('- Selected skills (0): none matched this diff');
  }
  if (summary.skipped.length) {
    log(`- Skipped skills (${summary.skipped.length}):`);
    summary.skipped.forEach((item) => {
      log(`  - ${item.id}: ${item.reasons.join('; ')}`);
    });
  }
}

function printDebugInfo(result, { log = console.log } = {}) {
  const debug = result.reviewDebug ?? {};
  const rawTokens = result.rawTokenEstimate ?? result.tokenEstimate;
  const reduction = result.reduction ?? 0;
  const plannerStatus = formatPlannerStatus(result.plan ?? {});
  const impactTags = Array.isArray(result.plan?.impactTags) ? result.plan.impactTags : [];
  log(`\nDebug info:
- LLM: ${debug.llmUsed ? `used (\`${debug.llmModel}\`)` : debug.llmSkipped || debug.llmError || 'not used'}
- Planner: ${plannerStatus}
- Impact tags: ${impactTags.join(', ') || 'none'}
- Token estimate (raw -> optimized): ${rawTokens} -> ${result.tokenEstimate} (${reduction}% reduction)
- Prompt truncated: ${debug.promptTruncated ? 'yes' : 'no'}
- Changed files (${result.changedFiles.length}): ${result.changedFiles.join(', ')}
- Project rules: ${result.projectRules ? 'present' : 'none'}
- Available contexts: ${(result.availableContexts || []).join(', ') || 'none'}
- Available dependencies: ${
    result.availableDependencies
      ? result.availableDependencies.join(', ')
      : 'not specified (skip disabled)'
  }
`);
  if (debug.llmError) {
    log(`LLM error: ${debug.llmError}`);
    // T64: パース失敗時に生のLLM出力が見えず切り分けができなかったため、
    // debug.rawLlmOutput があれば truncate してログに出す。
    logPreview('Raw LLM output', debug.rawLlmOutput, MAX_RAW_LLM_OUTPUT_PREVIEW_LENGTH, log);
  }
  logPreview('Prompt preview', debug.promptPreview, MAX_PROMPT_PREVIEW_LENGTH, log);
  logPreview(
    'Project-specific review rules (preview)',
    result.projectRules,
    MAX_PROMPT_PREVIEW_LENGTH,
    log,
    { leadingNewline: true }
  );
  if (result.plan?.skipped?.length) {
    log('\nSkipped skills detail:');
    result.plan.skipped.forEach((item) => {
      const id = item.skill?.metadata?.id ?? item.skill?.id ?? '(unknown)';
      log(`- ${id}: ${item.reasons.join('; ')}`);
    });
  }
  log('\n--- diff preview ---');
  log(result.diffText.split('\n').slice(0, MAX_DIFF_PREVIEW_LINES).join('\n'));
}

/**
 * Lazily compiled validator for schemas/output.schema.json (draft 2020-12).
 * Compiled once on first use; null if the schema cannot be loaded so a
 * validation problem never breaks JSON output emission.
 */
let outputSchemaValidator;
function getOutputSchemaValidator() {
  if (outputSchemaValidator !== undefined) return outputSchemaValidator;
  try {
    const schemaPath = fileURLToPath(new URL('../schemas/output.schema.json', import.meta.url));
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    outputSchemaValidator = ajv.compile(schema);
  } catch (err) {
    console.error(`Warning: could not load output.schema.json for validation: ${err.message}`);
    outputSchemaValidator = null;
  }
  return outputSchemaValidator;
}

/**
 * Validate a formatted artifact against output.schema.json at runtime and
 * report violations to stderr (#1254). Reporting only — the artifact is still
 * returned so a non-conforming LLM payload surfaces loudly instead of failing
 * silently downstream.
 */
function validateOutputArtifact(artifact) {
  const validate = getOutputSchemaValidator();
  if (!validate) return;
  if (!validate(artifact)) {
    console.error(
      `Warning: JSON output does not conform to schemas/output.schema.json:\n${JSON.stringify(
        validate.errors,
        null,
        2
      )}`
    );
  }
}

/**
 * Format review result as JSON conforming to schemas/output.schema.json.
 * Consumes the structured findings[] produced by the Finding Pipeline.
 * Additively includes a top-level `decision` field derived from scoreReview verdict.
 */
function formatJsonOutput(result, phase) {
  const issueCountBySeverity = { info: 0, minor: 0, major: 0, critical: 0 };
  const issueCountByPhase = { upstream: 0, midstream: 0, downstream: 0 };

  const issues = (result.findings ?? []).map((f) => {
    issueCountBySeverity[f.severity]++;
    issueCountByPhase[phase] = (issueCountByPhase[phase] ?? 0) + 1;
    return {
      id: f.id,
      ruleId: f.ruleId,
      reviewer: f.reviewer,
      title: f.title,
      message: f.message,
      severity: f.severity,
      confidence: f.confidence,
      status: f.status,
      evidence: f.evidence,
      phase,
      file: f.file,
      ...(f.lineStart ? { line: f.lineStart } : {}),
      ...(f.lineEnd && f.lineEnd !== f.lineStart ? { lineEnd: f.lineEnd } : {}),
      ...(f.suggestion ? { suggestion: f.suggestion } : {}),
      ...(f.consensusLevel ? { consensusLevel: f.consensusLevel } : {}),
      ...(f.reviewerRole ? { reviewerRole: f.reviewerRole } : {}),
    };
  });

  const priorityCounts = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const f of result.findings ?? []) {
    const p = severityToPriority(f.severity);
    priorityCounts[p]++;
  }
  const prioritySummary = {
    counts: priorityCounts,
    requiresImmediateAttention: priorityCounts.P1 > 0,
  };

  const summary = { issueCountBySeverity, issueCountByPhase, prioritySummary };
  const riskAssessment = result.plan?.riskAssessment;
  if (riskAssessment) {
    summary.riskSummary = {
      aggregateAction: riskAssessment.aggregateAction,
      escalatedFiles: riskAssessment.escalatedFiles,
      humanReviewFiles: riskAssessment.humanReviewFiles,
    };
  }
  // Gate + decision derivation shared with the run-record audit trail
  // (#1350 S3): extracted to src/lib/run-gate.mjs so the persisted record
  // and the JSON output always carry the same gate.
  const { decision, gate } = deriveRunGate(result);

  const artifact = {
    issues,
    summary,
    ...(decision !== undefined ? { decision } : {}),
    ...(gate ? { gate } : {}),
    ...(result.teamLeadReport ? { teamLeadReport: result.teamLeadReport } : {}),
  };
  validateOutputArtifact(artifact);
  return artifact;
}

function countChangedLines(files) {
  let lines = 0;
  for (const file of files ?? []) {
    for (const hunk of file.hunks ?? []) {
      lines += (hunk.lines ?? []).filter((l) => l.startsWith('+') || l.startsWith('-')).length;
    }
  }
  return lines;
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
    // Skills subcommands (import/export/list) – no git repo required
    if (parsed.command === 'skills' && parsed.skillsSubcommand === 'resolve') {
      // Deterministic resolution: which skills would run for the given
      // path(s) and phase. No git, no LLM — pure metadata routing, so
      // agents and CI can introspect skill selection cheaply (#1045).
      const paths = parsed.resolvePaths?.length ? parsed.resolvePaths : null;
      if (!paths) {
        console.error('Error: `river skills resolve` requires at least one --path <file>.');
        return 1;
      }
      const { buildExecutionPlan } = await import('../runners/core/review-runner.mjs');
      const plan = await buildExecutionPlan({
        phase: parsed.phase,
        changedFiles: paths,
        availableContexts: parsed.availableContexts ?? ['diff'],
        preferredModelHint: 'balanced',
      });
      if (parsed.output === 'json') {
        console.log(
          JSON.stringify(
            {
              phase: parsed.phase,
              paths,
              selected: plan.selected.map((s) => s.metadata?.id ?? s.id),
              skipped: plan.skipped.map((e) => ({
                id: e.skill?.metadata?.id ?? e.skill?.id,
                reasons: e.reasons,
              })),
            },
            null,
            2
          )
        );
        return 0;
      }
      console.log(`Resolved skills (phase=${parsed.phase}, paths=${paths.join(', ')}):`);
      if (!plan.selected.length) console.log('  (none matched)');
      for (const skill of plan.selected) {
        console.log(`  ✓ ${skill.metadata?.id ?? skill.id}`);
      }
      const skippedWithReasons = plan.skipped.filter((e) => e.reasons?.length);
      if (skippedWithReasons.length) {
        console.log('Skipped:');
        for (const e of skippedWithReasons) {
          console.log(`  - ${e.skill?.metadata?.id ?? e.skill?.id}: ${e.reasons.join('; ')}`);
        }
      }
      return 0;
    }

    if (parsed.command === 'skills' && parsed.skillsSubcommand) {
      const { runSkillsSubcommand } = await import('./lib/agent-skill-bridge.mjs');
      return runSkillsSubcommand(parsed);
    }

    if (parsed.command === 'skills') {
      const repoRoot = await ensureGitRepo(targetPath);
      const defaultBranch = await detectDefaultBranch(repoRoot);
      const mergeBase = await findMergeBase(repoRoot, defaultBranch);
      const repoDiff = await collectRepoDiff(repoRoot, mergeBase);

      const dispatcher = new SkillDispatcher(repoRoot);

      const getFileDiff = async (targetFile) => {
        const fileData = repoDiff.files.find((f) => f.path === targetFile);
        if (!fileData) return '';
        return renderDiffText([fileData]);
      };

      console.log(`River Review (Skills) - Target: ${targetPath}`);
      const results = await dispatcher.run(
        repoDiff.changedFiles,
        getFileDiff,
        parsed.phase,
        parsed.dryRun,
        parsed.debug
      );

      if (parsed.output === 'markdown') {
        console.log(`## Review Results\n`);
        for (const res of results) {
          console.log(`### ${res.file} (Skill: ${res.skill})`);
          console.log(res.review);
          console.log('\n---');
        }
      } else {
        console.log(JSON.stringify(results, null, 2));
      }
      return 0;
    }

    if (parsed.command === 'suppression') {
      if (parsed.suppressionSubcommand !== 'add') {
        console.error(
          'Error: only `river suppression add` is supported (need: --fingerprint --feedback --rationale).'
        );
        return 1;
      }
      if (!parsed.suppressionFingerprint) {
        console.error('Error: --fingerprint <16-hex> is required.');
        return 1;
      }
      if (!/^[0-9a-f]{16}$/.test(parsed.suppressionFingerprint)) {
        console.error('Error: --fingerprint must be exactly 16 lowercase hex chars.');
        return 1;
      }
      if (!parsed.suppressionFeedbackType) {
        console.error(
          'Error: --feedback <false_positive|accepted_risk|wont_fix|not_relevant|duplicate> is required.'
        );
        return 1;
      }
      const validFeedback = new Set([
        'false_positive',
        'accepted_risk',
        'wont_fix',
        'not_relevant',
        'duplicate',
      ]);
      if (!validFeedback.has(parsed.suppressionFeedbackType)) {
        console.error('Error: --feedback must be one of: ' + [...validFeedback].join(', ') + '.');
        return 1;
      }
      if (!parsed.suppressionRationale) {
        console.error('Error: --rationale "<why this finding is being suppressed>" is required.');
        return 1;
      }
      const validScope = new Set(['global', 'subsystem', 'file']);
      if (!validScope.has(parsed.suppressionScope)) {
        console.error('Error: --scope must be one of: global, subsystem, file.');
        return 1;
      }
      const repoRoot = await ensureGitRepo(targetPath);
      const indexPath = path.resolve(repoRoot, '.river', 'memory', 'index.json');
      const { createSuppression } = await import('./lib/suppression.mjs');
      const entry = createSuppression({
        indexPath,
        findingId: parsed.suppressionFindingId,
        fingerprint: parsed.suppressionFingerprint,
        feedbackType: parsed.suppressionFeedbackType,
        scope: parsed.suppressionScope,
        rationale: parsed.suppressionRationale,
        severity: parsed.suppressionSeverity,
        filePaths: parsed.suppressionFiles,
        expiresAt: parsed.suppressionExpiresAt,
        prNumber: parsed.suppressionPrNumber,
      });
      console.log('Suppression created: ' + entry.id);
      console.log('  fingerprint: ' + entry.context.fingerprint);
      console.log('  feedbackType: ' + entry.context.feedbackType);
      console.log('  scope: ' + entry.context.scope);
      if (entry.context.severity) console.log('  severity: ' + entry.context.severity);
      console.log('  written to: ' + indexPath);
      return 0;
    }

    if (parsed.command === 'feedback') {
      if (parsed.feedbackSubcommand !== 'add') {
        console.error(
          'Error: only `river feedback add` is supported (need: --type --skill; optional: --trigger --fingerprint --evidence --pr --reviewer --model --reversed-by).'
        );
        return 1;
      }
      const { buildFeedbackEntry, appendFeedbackEntry, buildFeedbackScaffold, FeedbackError } =
        await import('./lib/feedback.mjs');
      const repoRoot = await ensureGitRepo(targetPath);
      let entry;
      try {
        entry = buildFeedbackEntry({
          feedbackType: parsed.feedbackType,
          skillId: parsed.feedbackSkillId,
          trigger: parsed.feedbackTrigger ?? undefined,
          findingFingerprint: parsed.feedbackFingerprint,
          evidence: parsed.feedbackEvidence,
          pr: parsed.feedbackPrNumber,
          reviewer: parsed.feedbackReviewer,
          model: parsed.feedbackModel,
          reversedBy: parsed.feedbackReversedBy,
        });
      } catch (err) {
        if (err instanceof FeedbackError) {
          console.error(`Error: ${err.message}`);
          return 1;
        }
        throw err;
      }
      const filePath = await appendFeedbackEntry(entry, { repoRoot });
      const scaffold = buildFeedbackScaffold(entry);
      console.log('Feedback recorded: ' + entry.feedbackType + ' for ' + entry.skillId);
      console.log('  written to: ' + filePath);
      console.log('  next action: ' + scaffold.action);
      console.log('  apply scaffolds with: npm run feedback:apply');
      return 0;
    }

    if (parsed.command === 'runs') {
      const { resolveStoreDir, listRunRecords, loadRunRecord, computeDashboard, formatDashboard } =
        await import('./lib/result-store.mjs');
      const storeDir = resolveStoreDir(targetPath);

      if (!parsed.runsSubcommand || parsed.runsSubcommand === 'list') {
        const runs = await listRunRecords(storeDir);
        if (!runs.length) {
          console.log('No stored runs found in ' + storeDir);
          return 0;
        }
        console.log(`Stored runs (${storeDir}):\n`);
        for (const r of runs) {
          console.log(
            `  ${r.runId}  phase=${r.phase}  findings=${r.findingsCount}  suppressed=${r.suppressedCount}  files=${r.changedFilesCount}  ${r.timestamp}`
          );
        }
        return 0;
      }

      if (parsed.runsSubcommand === 'diff') {
        if (!parsed.runsId1 || !parsed.runsId2) {
          console.error('Error: river runs diff <id1> <id2> [<id3>...]');
          return 1;
        }
        const { diffReviews, diffRunHistory, formatRegressionSummary } =
          await import('./lib/review-differ.mjs');

        if (parsed.runsIds.length >= 3) {
          // Multi-run path: load all runs and detect oscillation
          const runRecords = await Promise.all(
            parsed.runsIds.map((id) => loadRunRecord(storeDir, id))
          );
          const diff = diffRunHistory(runRecords);
          // Sort by timestamp to find the latest run (same order as diffRunHistory).
          const sortedRecords = [...runRecords].sort((a, b) => {
            const ta = a.timestamp != null ? new Date(a.timestamp).getTime() : NaN;
            const tb = b.timestamp != null ? new Date(b.timestamp).getTime() : NaN;
            if (Number.isNaN(ta) && Number.isNaN(tb))
              return (a.runId ?? '').localeCompare(b.runId ?? '');
            if (Number.isNaN(ta)) return 1;
            if (Number.isNaN(tb)) return -1;
            return ta !== tb ? ta - tb : (a.runId ?? '').localeCompare(b.runId ?? '');
          });
          const latestRunArtifact = sortedRecords[sortedRecords.length - 1];
          const runsSignal = deriveLoopSignalFromRunsDiff(diff, latestRunArtifact);
          if (parsed.output === 'json') {
            const diffWithSignal = { ...diff, suggestedLoopSignal: runsSignal };
            console.log(JSON.stringify(diffWithSignal, null, 2));
          } else if (parsed.output === 'html') {
            const { formatLoopDashboardHtml } = await import('./lib/output-formatters/html.mjs');
            console.log(
              formatLoopDashboardHtml(diff, {
                runIds: sortedRecords.map((r) => r.runId),
                suggestedLoopSignal: runsSignal,
              })
            );
          } else {
            console.log(formatRegressionSummary(diff));
            if (diff.oscillated.length) {
              console.log('\n### Oscillating findings (' + diff.oscillated.length + ')');
              for (const o of diff.oscillated) {
                const f = o.finding ?? {};
                const file = f.file ?? '?';
                const title = (f.title || f.message || '').slice(0, 80);
                const timelineStr = o.timeline
                  .map((t) => `${t.runId.slice(0, 8)}:${t.present ? 'present' : 'absent'}`)
                  .join(' → ');
                console.log(`- \`${o.fingerprint}\` \`${file}\`: ${title}`);
                console.log(`  timeline: ${timelineStr}`);
              }
            } else {
              console.log('\nNo oscillating findings detected.');
            }
          }
        } else {
          // 2-run path: existing behaviour, byte-compatible
          const [run1, run2] = await Promise.all([
            loadRunRecord(storeDir, parsed.runsId1),
            loadRunRecord(storeDir, parsed.runsId2),
          ]);
          const diff = diffReviews(run1.findings ?? [], run2.findings ?? []);
          const runsSignal = deriveLoopSignalFromRunsDiff(diff, run2);
          if (parsed.output === 'json') {
            const diffWithSignal = { ...diff, suggestedLoopSignal: runsSignal };
            console.log(JSON.stringify(diffWithSignal, null, 2));
          } else if (parsed.output === 'html') {
            const { formatLoopDashboardHtml } = await import('./lib/output-formatters/html.mjs');
            console.log(
              formatLoopDashboardHtml(diff, {
                runIds: [run1.runId, run2.runId].filter(Boolean),
                suggestedLoopSignal: runsSignal,
              })
            );
          } else {
            console.log(formatRegressionSummary(diff));
          }
        }
        return 0;
      }

      if (parsed.runsSubcommand === 'summary') {
        const runs = await listRunRecords(storeDir);
        if (!runs.length) {
          console.log('No stored runs found in ' + storeDir);
          return 0;
        }
        // Load full records for dashboard computation
        const fullRuns = await Promise.all(
          runs.map((r) => loadRunRecord(storeDir, r.runId).catch(() => null))
        );
        const valid = fullRuns.filter(Boolean);
        const db = computeDashboard(valid);
        console.log(formatDashboard(db));
        return 0;
      }

      if (parsed.runsSubcommand === 'digest') {
        const { loadAllRunRecords } = await import('./lib/result-store.mjs');
        const fullRuns = await loadAllRunRecords(storeDir);
        if (!fullRuns.length) {
          console.log('No stored runs found in ' + storeDir);
          return 0;
        }
        const { buildRunsDigest, formatDigestMarkdown } = await import('./lib/runs-digest.mjs');
        const digest = buildRunsDigest(fullRuns, { now: () => new Date() });
        if (parsed.output === 'json') {
          console.log(JSON.stringify(digest, null, 2));
        } else {
          console.log(formatDigestMarkdown(digest));
        }
        return 0;
      }

      console.error(
        `Unknown runs subcommand: ${parsed.runsSubcommand}. Use: list | diff | summary | digest`
      );
      return 1;
    }

    if (parsed.command === 'eval') {
      const { evaluateReviewFixtures } = await import('./lib/review-fixtures-eval.mjs');
      const casesPath =
        parsed.fixturesCasesPath ||
        path.join(process.cwd(), 'tests', 'fixtures', 'review-eval', 'cases.json');
      return evaluateReviewFixtures({ casesPath, phase: parsed.phase, verbose: parsed.verbose });
    }
    if (parsed.command === 'doctor') {
      const result = await doctorLocalReview({
        cwd: targetPath,
        phase: parsed.phase,
        debug: parsed.debug,
        preferredModelHint: 'balanced',
        availableContexts: parsed.availableContexts,
        availableDependencies: parsed.availableDependencies,
      });

      const llmConfigured = isLlmEnabled();

      console.log(`River Review doctor
Repo: ${result.repoRoot}
Base branch: ${result.defaultBranch}
Merge base: ${result.mergeBase}
Skills loaded: ${result.skillsCount}
Project rules: ${result.projectRules ? 'present' : 'none'}
LLM (review): ${llmConfigured ? 'configured' : 'not set'}
LLM (planner): ${llmConfigured ? 'configured' : 'not set'}
Contexts: ${(result.availableContexts || []).join(', ') || 'none'}
Dependencies: ${
        result.availableDependencies
          ? result.availableDependencies.join(', ')
          : 'not specified (skip disabled)'
      }`);

      if (!llmConfigured) {
        printHintLines([
          'Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` to enable headless LLM reviews.',
          'Mechanical (no-key) checks and `--dry-run` / `--offline` still work without one.',
        ]);
      }

      if (!result.changedFiles.length) {
        console.log(`No changes to review compared to ${result.defaultBranch}.`);
        return 0;
      }

      if (result.plan) {
        printPlan(result.plan);
      }
      if (parsed.explain) {
        printExplain(result);
      }
      if (parsed.debug) {
        const impactTags = Array.isArray(result.plan?.impactTags) ? result.plan.impactTags : [];
        console.log(
          `\nDebug info:\n- Impact tags: ${impactTags.join(', ') || 'none'}\n- Token estimate: ${result.diff.tokenEstimate}\n`
        );
        console.log('--- diff preview ---');
        console.log(result.diff.diffText.split('\n').slice(0, MAX_DIFF_PREVIEW_LINES).join('\n'));
      }
      return 0;
    }

    // Resolve --skill-set to its skill ids up front so an unknown name fails
    // fast with a clear message before any review work begins.
    let skillIds = null;
    if (parsed.skillSet) {
      try {
        skillIds = await resolveSkillSet(parsed.skillSet);
      } catch (err) {
        if (err instanceof SkillLoaderError) {
          console.error(`Error: ${err.message}`);
          return 1;
        }
        throw err;
      }
    }

    const manualReviewMode = resolveDepthToReviewMode(parsed.depth);

    const context = await planLocalReview({
      cwd: targetPath,
      phase: parsed.phase,
      dryRun: parsed.dryRun,
      debug: parsed.debug,
      availableContexts: parsed.availableContexts,
      availableDependencies: parsed.availableDependencies,
      plannerMode: parsed.plannerMode,
      baseRef: parsed.base,
      skillIds,
      manualReviewMode,
    });

    const estimator = new CostEstimator(
      process.env.OPENAI_MODEL || process.env.RIVER_OPENAI_MODEL || undefined
    );
    const estimatedCost =
      context.status === 'ok'
        ? estimator.estimateFromDiff(context.diff, context.plan?.selected ?? [])
        : null;

    const logRunHeader =
      parsed.output === 'markdown' || parsed.output === 'json' || parsed.output === 'yaml'
        ? console.error
        : console.log;
    logRunHeader(`River Review (local)
Phase: ${parsed.phase}
Repo: ${context.repoRoot}
Base branch: ${context.defaultBranch}
Merge base: ${context.mergeBase}
Dry run: ${parsed.dryRun ? 'yes' : 'no'}
Debug: ${parsed.debug ? 'yes' : 'no'}
Planner: ${formatPlannerStatus(context.plan ?? {})}
Contexts: ${(context.availableContexts || []).join(', ') || 'none'}
Dependencies: ${
      context.availableDependencies
        ? context.availableDependencies.join(', ')
        : 'not specified (skip disabled)'
    }`);

    if (context.status === 'skipped-by-label') {
      const labels = context.matchedLabels?.length
        ? context.matchedLabels.join(', ')
        : '(not specified)';
      console.log(`Review skipped: PR labels matched exclude patterns (${labels}).`);
      return 0;
    }

    if (context.status === 'no-changes') {
      console.log(`No changes to review compared to ${context.defaultBranch}.`);
      return 0;
    }

    if (estimatedCost && parsed.maxCost !== null && estimatedCost.usd > parsed.maxCost) {
      console.log(estimator.formatCost(estimatedCost));
      console.error(
        `Estimated cost $${estimatedCost.usd.toFixed(4)} exceeds max-cost ${parsed.maxCost}. Aborting.`
      );
      return 1;
    }

    if (parsed.estimate) {
      if (!estimatedCost) {
        console.log('Cost estimation skipped (no changes or skipped by label).');
        return 0;
      }
      console.log('Cost Estimate:');
      console.log(estimator.formatCost(estimatedCost));
      console.log(`Files to review: ${context.changedFiles.length}`);
      console.log(
        `Lines changed (approx): ${countChangedLines(context.diff.filesForReview ?? context.diff.files)}`
      );
      return 0;
    }

    const result = await runLocalReview({
      cwd: targetPath,
      phase: parsed.phase,
      dryRun: parsed.dryRun,
      debug: parsed.debug,
      context,
      availableContexts: parsed.availableContexts,
      availableDependencies: parsed.availableDependencies,
      plannerMode: parsed.plannerMode,
      reviewers: parsed.reviewers,
      baseRef: parsed.base,
      skillIds,
      manualReviewMode,
    });

    if (parsed.explain) {
      printExplain(result);
    }

    // Persist run to result store when --save is provided. Under GitHub
    // Actions the save is AUTOMATIC (Epic #1347 S3, adversarial design
    // review Blocker 1: an opt-in store never accumulates the audit trail),
    // and the digest is appended to the job summary as the forced display
    // point — supervision that requires someone to remember a command is
    // not supervision.
    // M1 (#1372 review): RIVER_AUTO_SAVE=false opts out of the CI auto-save
    // (documented in the contract doc; the write target is .river/runs/).
    const isGithubActions =
      process.env.GITHUB_ACTIONS === 'true' && process.env.RIVER_AUTO_SAVE !== 'false';
    if ((parsed.save || isGithubActions) && result.status === 'ok') {
      try {
        const { buildRunRecord, saveRunRecord, resolveStoreDir } =
          await import('./lib/result-store.mjs');
        const { decision: runDecision, gate: runGate } = deriveRunGate(result);
        const record = buildRunRecord(result, {
          phase: parsed.phase,
          gate: runGate,
          decision: runDecision,
        });
        // Use targetPath (not result.repoRoot) so --save and runs list resolve the same storeDir
        const savedPath = await saveRunRecord(record, { storeDir: resolveStoreDir(targetPath) });
        console.error(`Run saved: ${record.runId} → ${savedPath}`);
      } catch (err) {
        console.error(`Warning: --save failed: ${err.message}`);
      }
    }

    // Forced display point (Epic #1347 S3): under GitHub Actions, append the
    // runs digest to the job summary. Fail-soft — the review result must
    // never break on digest generation.
    if (isGithubActions && process.env.GITHUB_STEP_SUMMARY && result.status === 'ok') {
      try {
        // C1 (#1372 review): the digest needs FULL records — the light
        // listRunRecords metadata has no gate/findings and silently produced
        // an empty digest here.
        const { loadAllRunRecords, resolveStoreDir } = await import('./lib/result-store.mjs');
        const { buildRunsDigest, formatDigestMarkdown } = await import('./lib/runs-digest.mjs');
        const records = await loadAllRunRecords(resolveStoreDir(targetPath));
        const digest = buildRunsDigest(records, { now: () => new Date() });
        const fs = await import('node:fs/promises');
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, '\n' + formatDigestMarkdown(digest));
      } catch (err) {
        console.error(`Warning: job summary digest failed: ${err.message}`);
      }
    }

    // Regression comparison when --baseline is provided
    if (parsed.baseline && result.status === 'ok') {
      try {
        const { diffReviews, formatRegressionSummary } = await import('./lib/review-differ.mjs');
        const baselineRaw = await import('node:fs/promises').then((fs) =>
          fs.readFile(parsed.baseline, 'utf8')
        );
        const baselineFindings = JSON.parse(baselineRaw);
        const prevFindings = Array.isArray(baselineFindings)
          ? baselineFindings
          : (baselineFindings.findings ?? baselineFindings.issues ?? []);
        const diff = diffReviews(prevFindings, result.findings ?? []);
        const regSummary = formatRegressionSummary(diff);
        console.log(regSummary);
      } catch (err) {
        console.error(`Warning: --baseline comparison failed: ${err.message}`);
      }
    }

    if (parsed.output === 'json') {
      console.log(JSON.stringify(formatJsonOutput(result, parsed.phase), null, 2));
    } else if (parsed.output === 'markdown') {
      printMarkdownReport(result, parsed.phase);
    } else if (parsed.output === 'yaml') {
      const { formatYamlOutput } = await import('./lib/output-formatters/yaml.mjs');
      const jsonOutput = formatJsonOutput(result, parsed.phase);
      const artifact = {
        phase: parsed.phase,
        timestamp: new Date().toISOString(),
        findings: jsonOutput.issues,
        plan: result.plan,
        // Propagate the canonical verdict so YAML matches JSON (#1170 F3).
        ...(jsonOutput.decision !== undefined ? { decision: jsonOutput.decision } : {}),
      };
      console.log(formatYamlOutput(artifact));
    } else if (parsed.output === 'html') {
      const { formatHtmlOutput } = await import('./lib/output-formatters/html.mjs');
      const jsonOutput = formatJsonOutput(result, parsed.phase);
      const htmlResult = {
        findings: result.findings ?? [],
        plan: result.plan,
        timestamp: new Date().toISOString(),
        // Propagate the canonical verdict so HTML matches JSON (#1170 F3).
        ...(jsonOutput.decision !== undefined ? { decision: jsonOutput.decision } : {}),
      };
      console.log(formatHtmlOutput(htmlResult, parsed.phase));
    } else {
      printPlan(result.plan);
      printComments(result.comments);
    }

    if (parsed.debug) {
      if (
        parsed.output === 'markdown' ||
        parsed.output === 'json' ||
        parsed.output === 'yaml' ||
        parsed.output === 'html'
      ) {
        console.error('\nDebug info (not included in output):');
        printDebugInfo(result, { log: console.error });
      } else {
        printDebugInfo(result);
      }
    }

    // #1066 self-review: honor --fail-on / --warn-on / --advisory-only on
    // `river run` too. Previously these were parsed but silently ignored on
    // the run path (only `river review` gated), so agents that relied on the
    // exit code never actually gated. Opt-in: exit 0 unless a gate flag is set.
    if (parsed.failOn || parsed.warnOn || parsed.advisoryOnly || parsed.gate) {
      const { resolveGateExitCode } = await import('./lib/gate-exit.mjs');
      return await resolveGateExitCode({
        failOn: parsed.failOn,
        warnOn: parsed.warnOn,
        advisoryOnly: parsed.advisoryOnly,
        gate: parsed.gate,
        // Derived the same way as the JSON-output gate so the exit code and the
        // emitted artifact agree. deriveRunGate is statically imported above.
        getGateInput: () => ({ findings: formatJsonOutput(result, parsed.phase).issues }),
        getGateObject: () => deriveRunGate(result).gate,
      });
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
