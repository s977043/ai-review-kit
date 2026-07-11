import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { isDirectRun } from './lib/is-direct-run.mjs';

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    input: null,
    failOnCritical: 1,
    failOnCriticalSet: false,
    failOnMajor: null,
    failOnMajorSet: false,
    help: false,
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === '--input') {
      parsed.input = args.shift() ?? null;
      continue;
    }
    if (arg === '--fail-on-critical') {
      const val = Number.parseInt(args.shift(), 10);
      if (Number.isNaN(val)) {
        console.error('Error: --fail-on-critical requires a numeric value.');
        parsed.help = true;
        break;
      }
      parsed.failOnCritical = val;
      parsed.failOnCriticalSet = true;
      continue;
    }
    if (arg === '--fail-on-major') {
      const val = Number.parseInt(args.shift(), 10);
      if (Number.isNaN(val)) {
        console.error('Error: --fail-on-major requires a numeric value.');
        parsed.help = true;
        break;
      }
      parsed.failOnMajor = val;
      parsed.failOnMajorSet = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }
  }

  return parsed;
}

/**
 * Evaluate River Review JSON output against severity thresholds.
 * Conforms to schemas/output.schema.json.
 *
 * @param {{ input: string, failOnCritical: number, failOnMajor: number | null }} options
 * @returns {Promise<{ pass: boolean, summary: string, table: string }>}
 */
export async function evaluateGate({ input, failOnCritical = 1, failOnMajor = null }) {
  const raw = await fs.readFile(input, 'utf8');
  const data = JSON.parse(raw);

  if (!data.summary?.issueCountBySeverity) {
    throw new Error('Invalid input: missing summary.issueCountBySeverity');
  }

  const counts = data.summary.issueCountBySeverity;
  for (const field of ['critical', 'major', 'minor', 'info']) {
    if (typeof counts[field] !== 'number') {
      throw new Error(`Invalid input: issueCountBySeverity.${field} must be a number`);
    }
  }
  const failures = [];

  if (failOnCritical !== null && counts.critical >= failOnCritical) {
    failures.push(`critical: ${counts.critical} (threshold: ${failOnCritical})`);
  }
  if (failOnMajor !== null && counts.major >= failOnMajor) {
    failures.push(`major: ${counts.major} (threshold: ${failOnMajor})`);
  }

  const pass = failures.length === 0;

  const table = [
    '| Severity | Count | Threshold | Status |',
    '| -------- | ----- | --------- | ------ |',
    `| critical | ${counts.critical} | ${failOnCritical ?? '-'} | ${failOnCritical !== null && counts.critical >= failOnCritical ? 'FAIL' : 'ok'} |`,
    `| major | ${counts.major} | ${failOnMajor ?? '-'} | ${failOnMajor !== null && counts.major >= failOnMajor ? 'FAIL' : 'ok'} |`,
    `| minor | ${counts.minor} | - | ok |`,
    `| info | ${counts.info} | - | ok |`,
  ].join('\n');

  const summary = pass
    ? `Gate PASSED: critical=${counts.critical}, major=${counts.major}, minor=${counts.minor}, info=${counts.info}`
    : `Gate FAILED: ${failures.join('; ')}`;

  return { pass, summary, table };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(`Usage: node scripts/evaluate-review-gate.mjs --input <json-path> [options]

Options:
  --input <path>          Path to River Review JSON output (required)
  --fail-on-critical <N>  Fail if critical count >= N (default: 1)
  --fail-on-major <N>     Fail if major count >= N (default: off)
  -h, --help              Show this help message
`);
    return 0;
  }

  if (!parsed.input) {
    console.error('Error: --input is required.');
    return 1;
  }

  // Load gate config from .river-review.json (CLI flags take precedence)
  let configGate = {};
  try {
    const configPath = path.resolve('.river-review.json');
    const configRaw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configRaw);
    configGate = config.gate ?? {};
  } catch (err) {
    // File not found is expected; warn on other errors (e.g. malformed JSON)
    if (err.code !== 'ENOENT') {
      console.error(`Warning: failed to load .river-review.json gate config: ${err.message}`);
    }
  }

  const failOnCritical = parsed.failOnCriticalSet
    ? parsed.failOnCritical
    : (configGate.failOnCritical ?? 1);
  const failOnMajor = parsed.failOnMajorSet ? parsed.failOnMajor : (configGate.failOnMajor ?? null);

  const inputPath = path.resolve(parsed.input);
  const result = await evaluateGate({
    input: inputPath,
    failOnCritical,
    failOnMajor,
  });

  console.log(result.summary);
  console.log('\n' + result.table);

  // Write GitHub Actions step summary if available
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const md = `## River Review Gate\n\n**${result.pass ? 'PASSED' : 'FAILED'}**\n\n${result.table}\n`;
    await fs.appendFile(summaryPath, md);
  }

  return result.pass ? 0 : 1;
}

// Only run main when executed directly (not imported as a module)
if (isDirectRun(import.meta.url)) {
  main().then((code) => {
    if (typeof code === 'number' && code !== 0) {
      process.exitCode = code;
    }
  });
}
