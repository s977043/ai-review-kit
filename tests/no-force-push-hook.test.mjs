import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// .claude/hooks/no-force-push.sh (PreToolUse hook) を実プロセス実行で検証する。
// 本物の PreToolUse ペイロードを stdin に流し、exit code だけで判定する
// （内部ロジックのモック呼び出しはしない）。
// exit 0 = 通過 / exit 2 = ブロック。
const HOOK = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.claude',
  'hooks',
  'no-force-push.sh'
);

function runHook(command) {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      session_id: 'test',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
    encoding: 'utf8',
  });
  return { status: res.status, stderr: res.stderr };
}

// --- ブロックすべきコマンド ------------------------------------------------
const BLOCKED = [
  // force push: 引数順に依存しないこと
  'git push --force',
  'git push --force origin feat/x',
  'git push origin feat/x --force',
  'git push -f origin feat/x',
  'git push origin feat/x -f',
  'git push --force-with-lease origin feat/x',
  'git push origin feat/x --force-with-lease',
  'git push --force-with-lease=refs/heads/feat/x origin feat/x',
  'git push -fu origin feat/x',
  // git のグローバルオプション経由
  'git -C /repo push --force origin feat/x',
  'git --git-dir=/repo/.git push origin feat/x --force',
  // 作業破棄系
  'git reset --hard',
  'git reset --hard origin/main',
  'git reset --hard HEAD~1',
  'git stash drop',
  'git stash drop stash@{0}',
  'git stash clear',
  // 複合コマンドの後段や制御構文の中に紛れているケース
  'git add -A && git commit -m "wip" && git push --force origin feat/x',
  'npm test; git reset --hard origin/main',
  'if [ -n "$CI" ]; then git push --force origin feat/x; fi',
  'git   push   origin   feat/x   --force',
  // 引用符で囲まれた force フラグ単体は「データ」ではなく引数
  'git push "--force" origin feat/x',
  // 行継続・複数行
  'git push \\\n  --force origin feat/x',
  'npm run lint\ngit push origin feat/x --force-with-lease',
];

// --- 通すべきコマンド ------------------------------------------------------
const ALLOWED = [
  // 通常の push（このフックが自分自身の作業を妨げないこと）
  'git push origin feat/x',
  'git push -u origin feat/x',
  'git push --set-upstream origin feat/x',
  'git push --follow-tags origin main',
  'git push origin HEAD',
  // fetch の --force は破壊操作ではない（release-please.yml が実際に使う）
  'git fetch --tags --force',
  'git fetch -f',
  'git fetch origin --tags --force && git push origin feat/x',
  // タグ張り替えは AGENTS.md Safety の対象外
  'git tag -f v1.0.0',
  'git tag -f -a v1 -m msg',
  // ローカル操作（散文の規律に留める / #1730）
  'git clean -fd',
  'git checkout -- src/foo.mjs',
  'git restore src/foo.mjs',
  'git restore --staged src/foo.mjs',
  // 禁止対象の「隣」にあるが AGENTS.md Safety の対象外のもの。
  // 将来パターンを広げすぎたときの回帰検知として固定する。
  'git checkout -f main',
  'git branch -f tmp origin/main',
  'git rebase origin/main',
  'git commit --amend --no-edit',
  // reset の非 --hard 形
  'git reset HEAD~1',
  'git reset --soft HEAD~1',
  'git reset --mixed HEAD',
  // stash の非破壊サブコマンド
  'git stash push -m wip',
  'git stash pop',
  'git stash list',
  // 引用符やヒアドキュメントの「中身」として --force を含むだけのケース
  'grep -rn -- "--force-with-lease" .',
  "grep -rn -- '--force-with-lease' docs/",
  'echo "do not use git push --force"',
  "echo 'git push --force is banned'",
  'rg "git push --force" docs/ AGENTS.md',
  'git commit -m "docs: ban git push --force in worker prompts"',
  'git commit -m "chore: allow git fetch --tags --force"',
  "cat > /tmp/note.md <<'EOF'\ngit push --force origin main\ngit reset --hard\nEOF",
  // git を含むが破壊操作ではないもの
  'git log --oneline -5 | grep -f /tmp/patterns.txt',
  'git status -sb',
  'git merge --ff-only origin/feat/x && git push origin feat/x',
  'npm test',
];

// サブテスト名にコマンド文字列を出すことで、
// テスト出力そのものが「どのコマンドがどちらに分類されたか」の一覧になる。
test('destructive git commands are blocked with exit 2', async (t) => {
  for (const cmd of BLOCKED) {
    await t.test(`BLOCK ${JSON.stringify(cmd)}`, () => {
      assert.equal(runHook(cmd).status, 2);
    });
  }
});

test('non-destructive commands pass with exit 0', async (t) => {
  for (const cmd of ALLOWED) {
    await t.test(`PASS ${JSON.stringify(cmd)}`, () => {
      assert.equal(runHook(cmd).status, 0);
    });
  }
});

test('block message names the command, the alternative, and the source', () => {
  const r = runHook('git push --force origin feat/x');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
  assert.match(r.stderr, /git push --force origin feat\/x/);
  assert.match(r.stderr, /AGENTS\.md Safety/);
  assert.match(r.stderr, /merge --ff-only/);
  assert.match(r.stderr, /escalate/);
});

test('passing commands produce no stderr noise', () => {
  const r = runHook('git push origin feat/x');
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('empty or malformed stdin payload passes', () => {
  for (const input of ['', '{not json', '{}', '{"tool_input":{}}']) {
    const res = spawnSync('bash', [HOOK], { input, encoding: 'utf8' });
    assert.equal(res.status, 0, JSON.stringify(input));
  }
});
