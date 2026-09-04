import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NOTHING_SCANNED_ERROR,
  checkControlCharacters,
  isForbiddenByte,
  listTargetFiles,
  scanBuffer,
} from '../scripts/check-control-characters.mjs';

// check-control-characters.mjs（#2055）のガード挙動を、一時 git リポジトリを cwd にした
// 実プロセス実行で検証する。positive（検出される）と negative（誤検出しない canary）の
// 両方を持つ（.claude/rules/review-core.md の責務分界 #1070）。
//
// fixture は「制御文字を含むファイル」を必要とするが、それをこのリポジトリへ置くと
// fixture 自身が検査に落ちる（#2055 の「fixture の置き場」）。そこでリポジトリ内には
// 一切置かず、テスト実行時に一時 git リポジトリを作って書き出す。
// 期待値はエスケープ列で書くので、このテストファイル自体はテキストのまま保たれる。
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'check-control-characters.mjs'
);

const CLEAN_SOURCE = "export const ok = 'value';\n\tindented();\n";
const NUL_SOURCE = "export const bad = 'skill\u0000id';\n";
const VT_SOURCE = "export const bad = 'a\u000Bb';\n";
const UNIT_SEP_SOURCE = "export const bad = 'a\u001Fb';\n";
const DEL_SOURCE = "export const bad = 'a\u007Fb';\n";
const CRLF_SOURCE = 'export const ok = 1;\r\n\texport const also = 2;\r\n';

/** 一時 git リポジトリを作り、files を書き出して `git add` する。 */
function gitFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-ctrl-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

function withFixture(files, fn) {
  const dir = gitFixture(files);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 実プロセスで CLI を起動し、exit code と stderr を返す。 */
function runIn(dir) {
  try {
    const stdout = execFileSync('node', [SCRIPT], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    if (typeof e.status !== 'number') throw e;
    return { status: e.status, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

test('isForbiddenByte: TAB / LF / CR は許可、その他の C0 と DEL は違反', () => {
  for (const allowed of [0x09, 0x0a, 0x0d]) {
    assert.equal(isForbiddenByte(allowed), false, `0x${allowed.toString(16)} は許可のはず`);
  }
  for (const code of [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f, 0x7f]) {
    assert.equal(isForbiddenByte(code), true, `0x${code.toString(16)} は違反のはず`);
  }
  // 通常の可読文字・UTF-8 の後続バイトは違反にしない。
  for (const code of [0x20, 0x41, 0x7e, 0x80, 0xe3, 0xff]) {
    assert.equal(isForbiddenByte(code), false, `0x${code.toString(16)} は許可のはず`);
  }
});

test('scanBuffer: 正常なファイル（TAB / LF / CR のみ）は検出なし', () => {
  assert.deepEqual(scanBuffer(Buffer.from(CLEAN_SOURCE, 'utf8')), []);
  assert.deepEqual(scanBuffer(Buffer.from(CRLF_SOURCE, 'utf8')), []);
});

test('scanBuffer: NUL を offset / 行 / 列つきで検出する', () => {
  const text = `line1\n${NUL_SOURCE}`;
  const hits = scanBuffer(Buffer.from(text, 'utf8'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].code, 0x00);
  assert.equal(hits[0].name, 'NUL');
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].offset, Buffer.from(text, 'utf8').indexOf(0x00));
  assert.equal(hits[0].column, NUL_SOURCE.indexOf('\u0000') + 1);
});

test('scanBuffer: TAB / LF / CR 以外の C0 と DEL も検出する', () => {
  for (const [source, code] of [
    [VT_SOURCE, 0x0b],
    [UNIT_SEP_SOURCE, 0x1f],
    [DEL_SOURCE, 0x7f],
  ]) {
    const hits = scanBuffer(Buffer.from(source, 'utf8'));
    assert.equal(hits.length, 1, `0x${code.toString(16)} を 1 件検出するはず`);
    assert.equal(hits[0].code, code);
  }
});

test('CLI: 正常な fixture のみなら exit 0', () => {
  withFixture(
    {
      'scripts/ok.mjs': CLEAN_SOURCE,
      'src/lib/ok.mjs': CRLF_SOURCE,
      'tests/ok.test.mjs': CLEAN_SOURCE,
    },
    (dir) => {
      const { status, stdout } = runIn(dir);
      assert.equal(status, 0, stdout);
      assert.match(stdout, /3 ファイル走査/);
    }
  );
});

test('CLI: NUL を含む fixture で exit 1（PR #2050 の事故と同形）', () => {
  withFixture({ 'scripts/bad.mjs': NUL_SOURCE, 'src/ok.mjs': CLEAN_SOURCE }, (dir) => {
    const { status, stderr } = runIn(dir);
    assert.equal(status, 1);
    assert.match(stderr, /scripts\/bad\.mjs:1:/);
    assert.match(stderr, /\(NUL\)/);
  });
});

test('CLI: TAB / LF / CR 以外の C0 を含む fixture で exit 1', () => {
  withFixture({ 'src/vt.mjs': VT_SOURCE, 'tests/us.test.mjs': UNIT_SEP_SOURCE }, (dir) => {
    const { status, stderr } = runIn(dir);
    assert.equal(status, 1);
    assert.match(stderr, /src\/vt\.mjs:/);
    assert.match(stderr, /tests\/us\.test\.mjs:/);
  });
});

test('CLI: pathspec 外のファイルに NUL があっても検出しない（scripts/ src/ tests/ に限る）', () => {
  withFixture(
    {
      'scripts/ok.mjs': CLEAN_SOURCE,
      'docs/bad.md': NUL_SOURCE,
      'assets/bad.bin': NUL_SOURCE,
      'runners/github-action/dist/index.js': NUL_SOURCE,
    },
    (dir) => {
      const { status, stdout } = runIn(dir);
      assert.equal(status, 0, stdout);
      assert.match(stdout, /1 ファイル走査/);
    }
  );
});

test('列挙は git ls-files 基準（未追跡ファイルは走査しない）', () => {
  withFixture({ 'scripts/ok.mjs': CLEAN_SOURCE }, (dir) => {
    // `git add` の後に書いたので未追跡のまま。ここが find ベースだと
    // .claude/worktrees/ のフルコピーまで拾ってしまう（ADR-009 D3-3 項番 1）。
    writeFileSync(join(dir, 'scripts', 'untracked.mjs'), NUL_SOURCE);
    assert.deepEqual(listTargetFiles(dir), ['scripts/ok.mjs']);
    const { status } = runIn(dir);
    assert.equal(status, 0);
  });
});

test('走査対象が 0 件なら OK ではなくエラーにする（すり抜け防止）', () => {
  withFixture({ 'docs/only.md': CLEAN_SOURCE }, (dir) => {
    const { errors, scanned } = checkControlCharacters({ root: dir });
    assert.equal(scanned, 0);
    assert.deepEqual(errors, [NOTHING_SCANNED_ERROR]);
    const { status, stderr } = runIn(dir);
    assert.equal(status, 1);
    assert.match(stderr, /走査対象が 0 件/);
  });
});

test('ALLOWED_FILES: 理由つきなら除外、理由が空ならエラー', () => {
  withFixture({ 'scripts/bad.mjs': NUL_SOURCE, 'src/ok.mjs': CLEAN_SOURCE }, (dir) => {
    const excused = checkControlCharacters({
      root: dir,
      allowedFiles: new Map([['scripts/bad.mjs', '検証用の意図的な制御文字']]),
    });
    assert.deepEqual(excused.violations, []);
    assert.deepEqual(excused.errors, []);
    assert.equal(excused.ignored.length, 1);

    const noReason = checkControlCharacters({
      root: dir,
      allowedFiles: new Map([['scripts/bad.mjs', '  ']]),
    });
    assert.equal(noReason.errors.length, 1);
    assert.match(noReason.errors[0], /理由が書かれていない/);
  });
});
