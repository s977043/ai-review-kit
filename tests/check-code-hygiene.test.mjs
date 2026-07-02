import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// check-code-hygiene.mjs のガード挙動を、一時 fixture を cwd にして実プロセス実行で検証する。
// positive（検出される）と negative（誤検出しない canary）の両方を持つ
// （.claude/rules/review-core.md の責務分界 #1070）。
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-code-hygiene.mjs'
);

function runIn(dir) {
  try {
    execFileSync('node', [SCRIPT], { cwd: dir, stdio: 'pipe' });
    return 0;
  } catch (e) {
    if (typeof e.status === 'number') return e.status;
    throw e;
  }
}

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-hygiene-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

test('duplicate-import: 同一モジュールからの重複 import を検出して exit 1', () => {
  const dir = fixture({
    'src/a.mjs': "import { x } from 'node:fs';\nimport { y } from 'node:fs';\nexport { x, y };\n",
  });
  try {
    assert.equal(runIn(dir), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate-import: 複数行 import でも検出する（exit 1）', () => {
  const dir = fixture({
    'src/a.mjs':
      "import { x } from 'node:fs';\nimport {\n  y,\n  z,\n} from 'node:fs';\nexport { x, y, z };\n",
  });
  try {
    assert.equal(runIn(dir), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate-import canary: 別モジュール / コメント行 / side-effect import は誤検出しない', () => {
  const dir = fixture({
    'src/a.mjs':
      "// import { y } from 'node:fs';\nimport { x } from 'node:fs';\nimport { p } from 'node:path';\nimport './side-effect.mjs';\nexport { x, p };\n",
    'src/side-effect.mjs': 'export {};\n',
  });
  try {
    assert.equal(runIn(dir), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tmp-literal: tests/** の /tmp ハードコードを検出して exit 1', () => {
  const dir = fixture({
    'tests/a.test.mjs': "const p = '/tmp/out.json';\nexport { p };\n", // code-hygiene-ignore
  });
  try {
    assert.equal(runIn(dir), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tmp-literal canary: os.tmpdir() 使用 / コメント内 / 抑制コメント / tests 外は誤検出しない', () => {
  const dir = fixture({
    'tests/a.test.mjs':
      "import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\n// '/tmp' はコメント内なので対象外\nconst ok = join(tmpdir(), 'out.json');\nconst intentional = '/tmp/legacy'; // code-hygiene-ignore\nexport { ok, intentional };\n",
    'src/b.mjs': "export const p = '/tmp/in-src-is-out-of-scope';\n", // code-hygiene-ignore
  });
  try {
    assert.equal(runIn(dir), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mkdtemp-cleanup: cleanup の無い mkdtempSync を検出して exit 1', () => {
  const dir = fixture({
    'tests/a.test.mjs':
      "import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nexport const d = mkdtempSync(join(tmpdir(), 'x-'));\n",
  });
  try {
    assert.equal(runIn(dir), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mkdtemp-cleanup canary: rmSync / t.after / finally があれば pass（exit 0）', () => {
  const dir = fixture({
    'tests/a.test.mjs':
      "import { mkdtempSync, rmSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nimport { join } from 'node:path';\nconst d = mkdtempSync(join(tmpdir(), 'x-'));\nrmSync(d, { recursive: true, force: true });\n",
  });
  try {
    assert.equal(runIn(dir), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fixtures ディレクトリ配下は scan 対象外（exit 0）', () => {
  const dir = fixture({
    'tests/fixtures/bad.mjs':
      "import { x } from 'node:fs';\nimport { y } from 'node:fs';\nconst p = '/tmp/x';\nexport { x, y, p };\n", // code-hygiene-ignore
  });
  try {
    assert.equal(runIn(dir), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
