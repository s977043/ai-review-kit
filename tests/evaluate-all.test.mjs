import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { appendLedger, evaluateAll, parseArgs } from '../scripts/evaluate-all.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

test('exports: evaluateAll, parseArgs, appendLedger are functions', () => {
  assert.equal(typeof evaluateAll, 'function');
  assert.equal(typeof parseArgs, 'function');
  assert.equal(typeof appendLedger, 'function');
});

test('parseArgs: defaults', () => {
  const result = parseArgs([]);
  assert.equal(result.gateInput, null);
  assert.equal(result.appendLedger, false);
  assert.equal(result.description, '');
  assert.equal(result.json, false);
  assert.equal(result.persistMemory, false);
  assert.equal(result.help, false);
  assert.equal(result.skip.size, 0);
});

test('parseArgs: --skip collects multiple values', () => {
  const result = parseArgs(['--skip', 'planner', '--skip', 'gate']);
  assert.ok(result.skip.has('planner'));
  assert.ok(result.skip.has('gate'));
  assert.equal(result.skip.size, 2);
});

test('parseArgs: all flags combined', () => {
  const gateInputPath = path.join(os.tmpdir(), 'out.json');
  const result = parseArgs([
    '--gate-input',
    gateInputPath,
    '--append-ledger',
    '--description',
    'test run',
    '--json',
    '--skip',
    'meta',
  ]);
  assert.equal(result.gateInput, gateInputPath);
  assert.equal(result.appendLedger, true);
  assert.equal(result.description, 'test run');
  assert.equal(result.json, true);
  assert.ok(result.skip.has('meta'));
});

test('parseArgs: -h sets help', () => {
  assert.ok(parseArgs(['-h']).help);
});

test('parseArgs: --help sets help', () => {
  assert.ok(parseArgs(['--help']).help);
});

test('parseArgs: --persist-memory flag', () => {
  const result = parseArgs(['--persist-memory']);
  assert.equal(result.persistMemory, true);
});

test('parseArgs: unknown flags are ignored', () => {
  const result = parseArgs(['--unknown', 'value']);
  assert.equal(result.help, false);
  assert.equal(result.gateInput, null);
});

test('appendLedger: writes valid JSONL entry', () => {
  const ledgerPath = path.join(ROOT, 'artifacts', 'evals', 'results.jsonl');
  const before = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : '';

  try {
    const marker = `__test_${Date.now()}`;
    appendLedger({ marker, timestamp: new Date().toISOString() });

    const content = fs.readFileSync(ledgerPath, 'utf8');
    const lastLine = content.trim().split('\n').pop();
    const parsed = JSON.parse(lastLine);
    assert.equal(parsed.marker, marker);
  } finally {
    fs.writeFileSync(ledgerPath, before);
  }
});
