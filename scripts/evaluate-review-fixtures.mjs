import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

import { evaluateReviewFixtures } from '../src/lib/review-fixtures-eval.mjs';

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    casesPath: null,
    phase: null,
    verbose: false,
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === '--cases') {
      parsed.casesPath = args.shift() ?? null;
      continue;
    }
    if (arg === '--phase') {
      parsed.phase = args.shift() ?? null;
      continue;
    }
    if (arg === '--verbose') {
      parsed.verbose = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }
  }

  return parsed;
}

async function main() {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.join(__dirname, '..');

  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(`Usage: node scripts/evaluate-review-fixtures.mjs [--cases <path>] [--phase <phase>] [--verbose]

Defaults:
  --cases tests/fixtures/review-eval/cases.json
`);
    return 0;
  }

  const casesPath = path.resolve(
    repoRoot,
    parsed.casesPath ?? path.join('tests', 'fixtures', 'review-eval', 'cases.json'),
  );

  return evaluateReviewFixtures({
    casesPath,
    phase: parsed.phase,
    verbose: parsed.verbose,
  });
}

main()
  .then(code => {
    process.exitCode = code;
  })
  .catch(err => {
    console.error(`Fixture runner error: ${err.message}`);
    process.exitCode = 1;
  });

