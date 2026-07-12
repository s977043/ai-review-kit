import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractRoutingTargetIds,
  expandApplyTo,
  analyzeCoverage,
} from '../scripts/lib/applyto-coverage.mjs';

test('extractRoutingTargetIds reads backtick IDs from table rows', () => {
  const md = [
    '| キーワード | スキルID | 説明 |',
    '| --- | --- | --- |',
    '| a11y | `a11y-accessible-name` | 説明 |',
    '| perf | `modern-web-performance` | 参照のみ。実行は `river-review-performance` |',
  ].join('\n');
  assert.deepEqual(extractRoutingTargetIds(md), [
    'a11y-accessible-name',
    'modern-web-performance',
    'river-review-performance',
  ]);
});

test('extractRoutingTargetIds excludes full-width-parenthesized see-also refs after an arrow', () => {
  // Real line from river-review-code/references/ROUTING.md: the parenthetical
  // cross-reference must not become a phantom target.
  const md =
    '3. `app/` ディレクトリ（Next.js）→ `river-review-frontend`（`nextjs-app-router-boundary`）も参照';
  assert.deepEqual(extractRoutingTargetIds(md), ['river-review-frontend']);
});

test('canary: arrow-line combo idiom yields every target (real ROUTING.md data)', () => {
  // Real lines: river-review-code/references/ROUTING.md ("+"-joined combo) and
  // river-review-frontend/references/ROUTING.md 自動判定ルール. Only taking the
  // first ID after the arrow would silently drop the later targets — a #1494/
  // #1500-type zero-signal path for targets that appear only in a combo line.
  const codeCombo =
    '- キーワード指定なし & TS ファイル → `typescript-strict` + `typescript-nullcheck`';
  assert.deepEqual(extractRoutingTargetIds(codeCombo), [
    'typescript-strict',
    'typescript-nullcheck',
  ]);
  const frontendCombo =
    '1. React/Vue/Svelte コンポーネントファイル → `a11y-accessible-name` + `modern-web-a11y-interactive` を追加';
  assert.deepEqual(extractRoutingTargetIds(frontendCombo), [
    'a11y-accessible-name',
    'modern-web-a11y-interactive',
  ]);
});

test('extractRoutingTargetIds ignores prose lines without table/arrow', () => {
  assert.deepEqual(extractRoutingTargetIds('本スキルは `river-review-code` を補完する。'), []);
});

test('extractRoutingTargetIds accepts single-word IDs (no hyphen required)', () => {
  assert.deepEqual(extractRoutingTargetIds('- → `router`'), ['router']);
  assert.deepEqual(extractRoutingTargetIds('| kw | `planner` | 説明 |'), ['planner']);
});

test('extractRoutingTargetIds dedupes preserving first-seen order', () => {
  const md = '- → `a-b`\n- → `c-d`\n- → `a-b`';
  assert.deepEqual(extractRoutingTargetIds(md), ['a-b', 'c-d']);
});

test('expandApplyTo accepts array or string and expands braces', () => {
  assert.deepEqual(expandApplyTo(['src/**/*.{ts,tsx}']), ['src/**/*.ts', 'src/**/*.tsx']);
  assert.deepEqual(expandApplyTo('**/*.sql'), ['**/*.sql']);
  assert.deepEqual(expandApplyTo(undefined), []);
});

test('analyzeCoverage: fully covered target has no disjoint patterns', () => {
  const entry = expandApplyTo(['src/**/*.{ts,tsx,js,jsx,mjs}']);
  const target = expandApplyTo(['src/**/*.{ts,tsx}']);
  const r = analyzeCoverage(entry, target);
  assert.equal(r.reachable, true);
  assert.deepEqual(r.disjoint, []);
});

test('analyzeCoverage: reports only patterns entirely disjoint from the entry', () => {
  // src/**/*.ts overlaps the entry (via src/routes) so it is NOT reported; only
  // the html patterns, which the entry never fires on, are disjoint.
  const entry = expandApplyTo([
    'src/**/*.{tsx,jsx,vue,svelte}',
    'src/routes/**/*.{ts,tsx,js,jsx}',
    'app/**/*.{ts,tsx,js,jsx}',
    'components/**/*.{ts,tsx,js,jsx}',
  ]);
  const target = expandApplyTo(['src/**/*.{ts,tsx,js,jsx,html}']);
  const r = analyzeCoverage(entry, target);
  assert.equal(r.reachable, true);
  assert.deepEqual(r.disjoint, ['src/**/*.html']);
});

test('analyzeCoverage: unreachable when every target pattern is disjoint', () => {
  const entry = expandApplyTo(['src/**/*.{ts,tsx,js,jsx,mjs}', '**/*.sql']);
  const target = expandApplyTo(['docs/**/*.md', 'design/**/*.md']);
  const r = analyzeCoverage(entry, target);
  assert.equal(r.reachable, false);
  assert.equal(r.disjoint.length, target.length);
});

test('analyzeCoverage: empty target is trivially reachable', () => {
  assert.deepEqual(analyzeCoverage(['src/**/*.ts'], []), {
    reachable: true,
    disjoint: [],
    undecidable: false,
  });
});
