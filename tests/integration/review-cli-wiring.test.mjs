// tests/integration/review-cli-wiring.test.mjs
//
// `src/cli/commands/review.mjs` の CLI 配線を pin する (#1971)。
//
// 背景: #1970 の変異注入で 5 件の生存変異が見つかった。いずれも
// 「ライブラリ単体は覆われているが、CLI から library への配線だけが
// 覆われていない」形である。既存の該当テストは CLI を通さず
// `runReviewPlan` を直接呼んでおり（tests/cli-review-plan.test.mjs:230 の
// "forwards skillIds" は skillIds をテスト側が直接渡している）、
// 転送行を落としても検出できなかった。
//
// したがって本ファイルのケースはすべて **CLI エントリポイント経由**
// (runCliInProcess / runCliAsSubprocess) で書く。`runReviewPlan` を直接
// 呼ぶ形にすると、まさに守りたい配線を素通りしてしまう。
//
// 覆う変異（#1971 本文の表）:
//   - route no-op        : runReviewRoute → return 0（stdout が丸ごと消える）
//   - M11                : `reviewFormat === 'markdown'` 分岐の無効化
//   - M9                 : --output-file の末尾改行の欠落
//   - M6                 : `parsed.skillSet && !isExecPlanReplay` → `parsed.skillSet`
//   - M14 / M15          : skillIds / availableContexts の転送欠落
//
// 出力捕捉の注意: `review plan|exec` は --output-file 未指定時に
// process.stdout.write で書き出す。runCliInProcess は console のみを
// 捕捉する（tests/helpers/cli.mjs 参照）ため、plan 側の内容検証は
// --output-file + ファイル読取で行い、stdout 直書きの検証だけ
// runCliAsSubprocess を使う。`review route` は console.log なので
// in-process で捕捉できる。

import assert from 'node:assert/strict';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { describe } from 'node:test';

import { runCliInProcess, runCliAsSubprocess } from '../helpers/cli.mjs';
import { createTempDir, cleanupTempDir } from '../helpers/temp-dir.mjs';
import { createTempGitRepo } from '../helpers/temp-repo.mjs';
import { resolveSkillSet } from '../../runners/core/skill-loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '..', 'fixtures', 'plangate-review-artifacts');

// `review route` が実際に見るのは「作業ツリー vs merge-base」の diff なので、
// 初期コミット済みファイルを working tree で書き換える形で変更を作る
// (git diff は untracked file を拾わない)。
const ROUTE_REPO_SEED = {
  'migrations/001_add_col.sql': '-- seed\n',
  'src/a.js': 'export const a = 1;\n',
  'docs/guide.md': 'old\n',
};

/** migration ファイルを変更した dirty repo（router のトリガーが実際にマッチする形）。 */
async function setupMigrationRepo(t) {
  const { dir, cleanup } = await createTempGitRepo({
    prefix: 'rr-route-mig-',
    initialFiles: ROUTE_REPO_SEED,
    changedFiles: {
      'migrations/001_add_col.sql': '-- seed\nALTER TABLE users ADD COLUMN a TEXT;\n',
      'src/a.js': 'export const a = 2;\n',
    },
  });
  t.after(cleanup);
  return dir;
}

/** docs だけを変更した dirty repo（docsTestOnly トリガー）。 */
async function setupDocsOnlyRepo(t) {
  const { dir, cleanup } = await createTempGitRepo({
    prefix: 'rr-route-docs-',
    initialFiles: ROUTE_REPO_SEED,
    changedFiles: { 'docs/guide.md': 'new docs line\n' },
  });
  t.after(cleanup);
  return dir;
}

/** PlanGate fixture（plan/todo/diff.patch）を撒いた一時ディレクトリ。 */
function setupPlanFixture(t) {
  const dir = createTempDir({ prefix: 'rr-review-wiring-' });
  t.after(() => cleanupTempDir(dir));
  for (const f of ['plan.md', 'todo.md', 'diff.patch']) {
    copyFileSync(join(FIXTURE, f), join(dir, f));
  }
  return dir;
}

/** artifact.plan に現れるすべての skill id（選択済み + スキップ済み）。 */
function plannedSkillIds(artifact) {
  return [
    ...artifact.plan.selectedSkills.map((s) => s.id),
    ...artifact.plan.skippedSkills.map((s) => s.id),
  ];
}

describe('river review route — stdout contract (#1971)', () => {
  test('emits a JSON object carrying the documented router keys (exit 0)', async (t) => {
    const dir = await setupMigrationRepo(t);
    const result = await runCliInProcess(['review', 'route'], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.notEqual(result.stdout.trim(), '', 'route must write its result to stdout');

    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.selectedMode, 'string');
    assert.ok(
      ['light', 'standard', 'team', 'human-required'].includes(parsed.selectedMode),
      `unexpected selectedMode: ${parsed.selectedMode}`
    );
    assert.ok(
      ['high', 'medium'].includes(parsed.confidence),
      `bad confidence: ${parsed.confidence}`
    );
    assert.ok(Array.isArray(parsed.reasons));
    assert.ok(parsed.reasons.every((r) => typeof r === 'string'));
    assert.ok(parsed.reasons.length > 0, 'reasons must never be empty');
    assert.ok(Array.isArray(parsed.matchedTriggers));
    assert.ok(parsed.matchedTriggers.every((t2) => typeof t2 === 'string'));
    assert.equal(typeof parsed.recommendedReviewers, 'string');
    assert.equal(typeof parsed.riskAction, 'string');
    assert.equal(typeof parsed.nextCommand, 'string');
    assert.ok(parsed.nextCommand.startsWith('river review plan '));
  });

  test('pins the two-space JSON indentation of the route payload', async (t) => {
    const dir = await setupMigrationRepo(t);
    const result = await runCliInProcess(['review', 'route'], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    // JSON.stringify(result, null, 2). 整形幅は成果物を diff する利用者にとって
    // 実契約なので、#1964 と同じ判断で固定する。
    assert.ok(
      result.stdout.startsWith('{\n  "selectedMode":'),
      `expected 2-space indented JSON, got: ${result.stdout.slice(0, 40)}`
    );
  });

  test('a migration change and a docs-only change route to DIFFERENT modes', async (t) => {
    const migRepo = await setupMigrationRepo(t);
    const docsRepo = await setupDocsOnlyRepo(t);

    const mig = await runCliInProcess(['review', 'route'], { cwd: migRepo });
    assert.equal(mig.code, 0, mig.stderr);
    const migResult = JSON.parse(mig.stdout);

    const docs = await runCliInProcess(['review', 'route'], { cwd: docsRepo });
    assert.equal(docs.code, 0, docs.stderr);
    const docsResult = JSON.parse(docs.stdout);

    // 縮退防止: 別入力が別結果になることを先に主張する (#1970 で
    // route-base-bogus == route-bare の縮退が見つかっている)。
    assert.notDeepEqual(migResult, docsResult);

    assert.equal(migResult.selectedMode, 'team');
    assert.equal(migResult.confidence, 'high');
    assert.deepEqual(migResult.matchedTriggers, ['fileType:migration']);
    assert.equal(migResult.recommendedReviewers, 'auto');
    assert.ok(migResult.nextCommand.endsWith('--depth thorough --reviewers auto'));

    assert.equal(docsResult.selectedMode, 'light');
    assert.equal(docsResult.confidence, 'medium');
    assert.deepEqual(docsResult.matchedTriggers, ['docsTestOnly']);
    assert.equal(docsResult.recommendedReviewers, 'none');
    assert.ok(docsResult.nextCommand.endsWith('--depth quick'));
  });

  test('--format markdown renders the Markdown report instead of JSON', async (t) => {
    const dir = await setupMigrationRepo(t);
    const result = await runCliInProcess(['review', 'route', '--format', 'markdown'], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.split('\n')[0], '## Review Mode Router');
    assert.ok(result.stdout.includes('| 選択モード | `team` |'));
    assert.throws(() => JSON.parse(result.stdout), 'markdown output must not be JSON');
  });

  test('--output markdown is honored, and an explicit --format wins over it', async (t) => {
    const dir = await setupMigrationRepo(t);

    const viaOutput = await runCliInProcess(['review', 'route', '--output', 'markdown'], {
      cwd: dir,
    });
    assert.equal(viaOutput.code, 0, viaOutput.stderr);
    assert.equal(viaOutput.stdout.split('\n')[0], '## Review Mode Router');

    const formatWins = await runCliInProcess(
      ['review', 'route', '--format', 'json', '--output', 'markdown'],
      { cwd: dir }
    );
    assert.equal(formatWins.code, 0, formatWins.stderr);
    assert.equal(JSON.parse(formatWins.stdout).selectedMode, 'team');
  });

  test('--output yaml (not a route format) falls back to JSON, not an error', async (t) => {
    const dir = await setupMigrationRepo(t);
    const result = await runCliInProcess(['review', 'route', '--output', 'yaml'], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).selectedMode, 'team');
  });

  test('--format text is rejected with exit 3 and an explanatory stderr line', async (t) => {
    const dir = await setupMigrationRepo(t);
    const result = await runCliInProcess(['review', 'route', '--format', 'text'], { cwd: dir });
    assert.equal(result.code, 3);
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /river review route only supports --format json or --format markdown \(got "text"\)\./
    );
  });

  test('a clean repo (no changes) still emits the default standard recommendation', async (t) => {
    const { dir, cleanup } = await createTempGitRepo({
      prefix: 'rr-route-clean-',
      initialFiles: ROUTE_REPO_SEED,
    });
    t.after(cleanup);
    const result = await runCliInProcess(['review', 'route'], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.selectedMode, 'standard');
    assert.equal(parsed.confidence, 'medium');
    assert.deepEqual(parsed.matchedTriggers, []);
    assert.equal(parsed.recommendedReviewers, 'none');
  });

  test('a non-git target exits 1 with the git error on stderr', async (t) => {
    const dir = createTempDir({ prefix: 'rr-route-nongit-' });
    t.after(() => cleanupTempDir(dir));
    const result = await runCliInProcess(['review', 'route'], { cwd: dir });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Error: Not a git repository/);
  });
});

describe('river review plan|exec — CLI → library flag forwarding (#1971)', () => {
  test('--skill-set restricts the planned skills (CLI-level wiring, not a direct call)', async (t) => {
    const dir = setupPlanFixture(t);
    const basicIds = await resolveSkillSet('basic');
    assert.ok(basicIds.length > 0, 'the `basic` skill set must be non-empty for this pin');

    const restrictedOut = join(dir, 'restricted.json');
    const restricted = await runCliInProcess(
      [
        'review',
        'plan',
        '--plan-only',
        '--phase',
        'upstream',
        '--skill-set',
        'basic',
        '--output-file',
        restrictedOut,
      ],
      { cwd: dir }
    );
    assert.equal(restricted.code, 0, restricted.stderr);
    const restrictedArtifact = JSON.parse(readFileSync(restrictedOut, 'utf8'));
    const restrictedIds = plannedSkillIds(restrictedArtifact);
    assert.ok(restrictedIds.length > 0, 'the restricted plan must still mention its own skills');
    for (const id of restrictedIds) {
      assert.ok(
        basicIds.includes(id),
        `--skill-set basic was not forwarded: "${id}" is outside the set`
      );
    }

    // 対照: --skill-set なしでは set の外のスキルが必ず現れる。
    // これがないと「set 転送を落としても同じ」に縮退しうる。
    const openOut = join(dir, 'open.json');
    const open = await runCliInProcess(
      ['review', 'plan', '--plan-only', '--phase', 'upstream', '--output-file', openOut],
      { cwd: dir }
    );
    assert.equal(open.code, 0, open.stderr);
    const openIds = plannedSkillIds(JSON.parse(readFileSync(openOut, 'utf8')));
    assert.ok(
      openIds.some((id) => !basicIds.includes(id)),
      'without --skill-set the plan must reach skills outside the `basic` set'
    );
    assert.ok(openIds.length > restrictedIds.length);
  });

  test('--context is forwarded so tests-context skills stop being skipped', async (t) => {
    const dir = setupPlanFixture(t);

    const withoutOut = join(dir, 'no-context.json');
    const without = await runCliInProcess(
      ['review', 'plan', '--plan-only', '--phase', 'downstream', '--output-file', withoutOut],
      { cwd: dir }
    );
    assert.equal(without.code, 0, without.stderr);
    const withoutArtifact = JSON.parse(readFileSync(withoutOut, 'utf8'));
    assert.deepEqual(
      withoutArtifact.plan.selectedSkills.map((s) => s.id),
      [],
      'baseline: without --context nothing is selectable on this fixture'
    );
    const withoutSkipReasons = withoutArtifact.plan.skippedSkills
      .filter((s) => s.id === 'coverage-gap' || s.id === 'test-existence')
      .flatMap((s) => s.reasons);
    assert.ok(withoutSkipReasons.includes('missing inputContext: tests'));

    const withOut = join(dir, 'with-context.json');
    const withCtx = await runCliInProcess(
      [
        'review',
        'plan',
        '--plan-only',
        '--phase',
        'downstream',
        '--context',
        'tests',
        '--output-file',
        withOut,
      ],
      { cwd: dir }
    );
    assert.equal(withCtx.code, 0, withCtx.stderr);
    const withArtifact = JSON.parse(readFileSync(withOut, 'utf8'));
    assert.deepEqual(
      withArtifact.plan.selectedSkills.map((s) => s.id).sort(),
      ['coverage-gap', 'test-existence'],
      '--context tests was not forwarded to the plan layer'
    );
  });

  test('--output-file content ends with exactly one trailing newline', async (t) => {
    const dir = setupPlanFixture(t);
    const out = join(dir, 'newline.json');
    const result = await runCliInProcess(
      [
        'review',
        'plan',
        '--plan-only',
        '--phase',
        'upstream',
        '--skill-set',
        'basic',
        '--output-file',
        out,
      ],
      { cwd: dir }
    );
    assert.equal(result.code, 0, result.stderr);
    const raw = readFileSync(out, 'utf8');
    // POSIX の行末契約: 最終行は改行で終わる。二重改行にもしない。
    assert.ok(
      raw.endsWith('}\n'),
      `expected a single trailing newline, got ${JSON.stringify(raw.slice(-4))}`
    );
    assert.ok(!raw.endsWith('\n\n'));
  });

  test('--format markdown writes the Markdown summary to --output-file, not JSON', async (t) => {
    const dir = setupPlanFixture(t);
    const out = join(dir, 'summary.md');
    const result = await runCliInProcess(
      [
        'review',
        'plan',
        '--plan-only',
        '--phase',
        'upstream',
        '--skill-set',
        'basic',
        '--format',
        'markdown',
        '--output-file',
        out,
      ],
      { cwd: dir }
    );
    assert.equal(result.code, 0, result.stderr);
    const raw = readFileSync(out, 'utf8');
    assert.equal(raw.split('\n')[0], '# river review plan');
    assert.ok(raw.includes('- Status: `ok`'));
    assert.throws(() => JSON.parse(raw), '--format markdown must not emit the JSON artifact');
    // レンダラ自身の末尾改行 + CLI が足す 1 本で、正確に 2 本。
    assert.ok(raw.endsWith('\n\n') && !raw.endsWith('\n\n\n'), JSON.stringify(raw.slice(-4)));
  });

  test('--format markdown also switches the stdout payload (subprocess)', async (t) => {
    const dir = setupPlanFixture(t);
    const result = await runCliAsSubprocess(
      [
        'review',
        'plan',
        '--plan-only',
        '--phase',
        'upstream',
        '--skill-set',
        'basic',
        '--format',
        'markdown',
      ],
      { cwd: dir }
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.split('\n')[0], '# river review plan');
    assert.ok(
      result.stdout.endsWith('\n\n') && !result.stdout.endsWith('\n\n\n'),
      JSON.stringify(result.stdout.slice(-4))
    );
  });

  test('exec --plan replay does NOT resolve --skill-set (unknown set name is ignored)', async (t) => {
    const dir = setupPlanFixture(t);
    const planPath = join(dir, 'source-plan.json');
    const seed = await runCliInProcess(
      [
        'review',
        'plan',
        '--plan-only',
        '--phase',
        'upstream',
        '--skill-set',
        'basic',
        '--output-file',
        planPath,
      ],
      { cwd: dir }
    );
    assert.equal(seed.code, 0, seed.stderr);

    // 対照: 非 replay の plan では同じ名前が exit 3 で拒否される。
    const rejected = await runCliInProcess(
      [
        'review',
        'plan',
        '--plan-only',
        '--skill-set',
        'no-such-set-xyz',
        '--output-file',
        join(dir, 'x.json'),
      ],
      { cwd: dir }
    );
    assert.equal(rejected.code, 3);
    assert.match(rejected.stderr, /Unknown skill set "no-such-set-xyz"/);

    // replay では skill 選択が行われないので、同じ名前でも解決されない。
    const replayOut = join(dir, 'replayed.json');
    const replay = await runCliInProcess(
      [
        'review',
        'exec',
        '--plan',
        planPath,
        '--dry-run',
        '--skill-set',
        'no-such-set-xyz',
        '--output-file',
        replayOut,
      ],
      { cwd: dir }
    );
    assert.equal(replay.code, 0, replay.stderr);
    assert.doesNotMatch(replay.stderr, /Unknown skill set/);
    assert.equal(JSON.parse(readFileSync(replayOut, 'utf8')).version, '1');
  });
});
