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
  formatViolationLines,
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

test('CLI: 除外した場所（assets/ と action dist）の NUL は検出しない', () => {
  withFixture(
    {
      'scripts/ok.mjs': CLEAN_SOURCE,
      'assets/bad.bin': NUL_SOURCE,
      'runners/github-action/dist/index.mjs': NUL_SOURCE,
    },
    (dir) => {
      const { status, stdout } = runIn(dir);
      assert.equal(status, 0, stdout);
      assert.match(stdout, /1 ファイル走査/);
    }
  );
});

test('CLI: scripts/ src/ tests/ の外（skills/ docs/ .github/ ルート）も既定で保護される', () => {
  // 初版は scripts/ src/ tests/ の許可リストで、skills/ 549 件などが無防備だった。
  // 「全部から除外を引く」形にしたので、これらは追加設定なしで対象に入る。
  const files = {
    'skills/upstream/foo/SKILL.md': NUL_SOURCE,
    'commands/bar.md': NUL_SOURCE,
    'agents/baz.md': NUL_SOURCE,
    'runners/github-action/src/main.mjs': NUL_SOURCE,
    '.github/workflows/ci.yml': NUL_SOURCE,
    'docusaurus.config.js': NUL_SOURCE,
  };
  withFixture(files, (dir) => {
    const { status, stderr } = runIn(dir);
    assert.equal(status, 1);
    for (const rel of Object.keys(files)) {
      assert.ok(stderr.includes(rel), `${rel} が報告されていない`);
    }
  });
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
  // 除外だけで構成されたリポジトリ ＝ 走査対象ゼロ。
  withFixture({ 'assets/only.png': CLEAN_SOURCE }, (dir) => {
    const { errors, scanned } = checkControlCharacters({ root: dir });
    assert.equal(scanned, 0);
    assert.deepEqual(errors, [NOTHING_SCANNED_ERROR]);
    const { status, stderr } = runIn(dir);
    assert.equal(status, 1);
    assert.match(stderr, /走査対象が 0 件/);
  });
});

test('ALLOWED_FILES: 理由つきなら除外、理由が空・非文字列ならエラー', () => {
  withFixture({ 'scripts/bad.mjs': NUL_SOURCE, 'src/ok.mjs': CLEAN_SOURCE }, (dir) => {
    const excused = checkControlCharacters({
      root: dir,
      allowedFiles: new Map([['scripts/bad.mjs', '検証用の意図的な制御文字']]),
    });
    assert.deepEqual(excused.violations, []);
    assert.deepEqual(excused.errors, []);
    assert.equal(excused.ignored.length, 1);

    for (const reason of ['  ', 0, null, undefined]) {
      const bad = checkControlCharacters({
        root: dir,
        allowedFiles: new Map([['scripts/bad.mjs', reason]]),
      });
      const found = bad.errors.filter((e) => /理由が書かれていない/.test(e));
      assert.equal(found.length, 1, `reason=${JSON.stringify(reason)} を弾けていない`);
    }
  });
});

test('ALLOWED_FILES: 走査対象に存在しない path の除外はエラー（期限切れ検知）', () => {
  withFixture({ 'scripts/ok.mjs': CLEAN_SOURCE }, (dir) => {
    const { errors } = checkControlCharacters({
      root: dir,
      allowedFiles: new Map([['scripts/gone.mjs', '昔あったファイル']]),
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /期限切れの除外/);
  });
});

test('formatViolationLines: 1 ファイルあたりの出力を上限で切り、残件をサマリにする', () => {
  const hits = Array.from({ length: 12 }, (_, i) => ({
    file: 'scripts/many.mjs',
    line: i + 1,
    column: 1,
    offset: i,
    code: 0x00,
    name: 'NUL',
  }));
  const lines = formatViolationLines(hits, 5);
  assert.equal(lines.length, 6, '5 行 + 残件サマリ 1 行');
  assert.match(lines[5], /ほか 7 件/);
  assert.match(lines[5], /全 12 件/);
});

test('CLI: エラーと違反が同時に起きても違反を隠さない', () => {
  withFixture({ 'scripts/bad.mjs': NUL_SOURCE }, (dir) => {
    // 存在しない path の除外を混ぜてエラーを 1 件作る。
    const { violations, errors } = checkControlCharacters({
      root: dir,
      allowedFiles: new Map([['scripts/gone.mjs', '期限切れ']]),
    });
    assert.equal(violations.length, 1, '違反は握り潰されない');
    assert.equal(errors.length, 1);
  });
});
