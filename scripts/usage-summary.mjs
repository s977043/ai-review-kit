#!/usr/bin/env node
/**
 * Aggregate JSONL usage records under artifacts/usage/*.jsonl into a
 * single summary that surfaces token volumes, cache hit ratios and
 * estimated USD cost per (model, skill, runId, day).
 *
 * Usage:
 *   node scripts/usage-summary.mjs                 # auto-discover artifacts/usage
 *   node scripts/usage-summary.mjs --dir <path>    # custom directory
 *   node scripts/usage-summary.mjs --group skill   # group=model|skill|run|day
 *   node scripts/usage-summary.mjs --json          # emit JSON instead of text
 *
 * Designed to be safe to run with zero events (prints "no usage records").
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostEstimator } from '../src/core/cost-estimator.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(SCRIPT_DIR, '..', 'artifacts', 'usage');

function parseArgs(argv) {
  const args = { dir: DEFAULT_DIR, group: 'model', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--group') args.group = argv[++i];
    else if (a === '--json') args.json = true;
  }
  return args;
}

async function readJsonlFiles(dir) {
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const records = [];
  for (const name of files.filter((f) => f.endsWith('.jsonl'))) {
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        records.push(JSON.parse(t));
      } catch {
        // Skip malformed lines; they are observable in the raw file.
      }
    }
  }
  return records;
}

function groupKey(record, group) {
  switch (group) {
    case 'skill':
      return record.skill ?? '(unknown)';
    case 'run':
      return record.runId ?? '(none)';
    case 'day':
      return (record.timestamp ?? '').slice(0, 10) || '(no-date)';
    case 'model':
    default:
      return record.model ?? '(unknown)';
  }
}

function emptyBucket() {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    usd: 0,
  };
}

export function aggregate(records, group = 'model') {
  const buckets = new Map();
  const estimator = new CostEstimator();
  for (const r of records) {
    const key = groupKey(r, group);
    if (!buckets.has(key)) buckets.set(key, emptyBucket());
    const b = buckets.get(key);
    b.calls += 1;
    b.inputTokens += r.inputTokens ?? 0;
    b.outputTokens += r.outputTokens ?? 0;
    b.cacheCreationTokens += r.cacheCreationInputTokens ?? 0;
    b.cacheReadTokens += r.cacheReadInputTokens ?? 0;
    const cost = estimator.estimateFromUsage({
      provider: r.provider,
      model: r.model,
      inputTokens: r.inputTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      cacheCreationInputTokens: r.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: r.cacheReadInputTokens ?? 0,
    });
    b.usd += cost?.usd ?? 0;
  }
  // Compute cache hit ratio for surface in report.
  const summary = [...buckets.entries()].map(([key, b]) => {
    const totalInput = b.inputTokens || 1;
    const cacheRatio = b.cacheReadTokens / totalInput;
    return {
      key,
      ...b,
      usd: Math.round(b.usd * 10000) / 10000,
      cacheHitRatio: Math.round(cacheRatio * 1000) / 1000,
    };
  });
  summary.sort((a, b) => b.usd - a.usd);
  return summary;
}

export function formatText(summary, group) {
  if (summary.length === 0) return 'no usage records';
  const header = `Group: ${group}`;
  const rows = summary.map(
    (s) =>
      `  ${s.key.padEnd(28)} calls=${String(s.calls).padStart(4)} ` +
      `in=${String(s.inputTokens).padStart(8)} ` +
      `out=${String(s.outputTokens).padStart(7)} ` +
      `cacheRead=${String(s.cacheReadTokens).padStart(8)} ` +
      `hit=${(s.cacheHitRatio * 100).toFixed(1).padStart(5)}% ` +
      `usd=$${s.usd.toFixed(4)}`
  );
  const totals = summary.reduce(
    (acc, s) => ({
      calls: acc.calls + s.calls,
      inputTokens: acc.inputTokens + s.inputTokens,
      outputTokens: acc.outputTokens + s.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + s.cacheReadTokens,
      usd: acc.usd + s.usd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usd: 0 }
  );
  rows.push('');
  rows.push(
    `  TOTAL                        calls=${String(totals.calls).padStart(4)} ` +
      `in=${String(totals.inputTokens).padStart(8)} ` +
      `out=${String(totals.outputTokens).padStart(7)} ` +
      `cacheRead=${String(totals.cacheReadTokens).padStart(8)} ` +
      `             usd=$${totals.usd.toFixed(4)}`
  );
  return [header, ...rows].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = await readJsonlFiles(args.dir);
  const summary = aggregate(records, args.group);
  if (args.json) {
    process.stdout.write(JSON.stringify({ group: args.group, summary }, null, 2) + '\n');
  } else {
    process.stdout.write(formatText(summary, args.group) + '\n');
  }
}

// Only run when invoked as a script (not when imported by tests).
if (isDirectRun(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`usage-summary failed: ${err?.message || err}\n`);
    process.exit(1);
  });
}
