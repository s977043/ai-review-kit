import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  DOC_ENUMERATION_SPECS,
  GUARD_LEDGER_PATH,
  NOTHING_CHECKED_ERROR,
  checkDocEnumerations,
  parseGuardLedger,
  parseGuardTitles,
  parseIgnoreDirectives,
  parseMarkdownTableColumn,
  parseSkillStreamCounts,
  resolveIgnoreKeys,
  unwrapCodeSpan,
} from '../scripts/check-doc-enumerations.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * 実ドキュメントを読む（改変して readDoc に注入するため）。
 *
 * doc-enum:ignore は取り除く。実 doc に緊急回避の ignore が入っている状態でも、
 * ここでの「drift を本当に検出できるか」の検証は成立しなければならない
 * （ignore が入った途端に Unit tests が落ちると、MUST1 と同じ罠を再生産する）。
 */
async function readRepoFile(relPath) {
  const text = await fs.readFile(path.join(REPO_ROOT, relPath), 'utf8');
  return text.replace(/<!--\s*doc-enum:ignore[^]*?-->\r?\n?/g, '');
}

/** 登録済み spec を id で引く。 */
function realSpec(id) {
  const spec = DOC_ENUMERATION_SPECS.find((s) => s.id === id);
  assert.ok(spec, `registered spec not found: ${id}`);
  return spec;
}

/**
 * 常に成功する詰め物 spec。検証対象 spec が 1 件だけ落ちるケースで
 * NOTHING_CHECKED_ERROR が混ざらないようにするために足す。
 */
function passingSpec(id = 'filler-spec') {
  return {
    id,
    doc: 'docs/example.md',
    summary: 'ダミー',
    marker: 'ダミー',
    kind: 'names',
    declare: () => new Set(['x']),
    measure: async () => new Set(['x']),
  };
}

test('parseMarkdownTableColumn reads the named column of the first matching table', () => {
  const text = [
    '# Doc',
    '',
    '| Component | Location |',
    '| --------- | -------- |',
    '| Hooks     | `a.sh`   |',
    '',
    '| Command  | File       | Purpose |',
    '| -------- | ---------- | ------- |',
    '| `/check` | `check.md` | Checks  |',
    '| `/pr`    | `pr.md`    | PR      |',
    '',
    'trailing prose',
  ].join('\n');

  assert.deepEqual(parseMarkdownTableColumn(text, 'File'), ['`check.md`', '`pr.md`']);
  assert.deepEqual(parseMarkdownTableColumn(text, 'Command'), ['`/check`', '`/pr`']);
});

test('parseMarkdownTableColumn returns null when the header is absent', () => {
  const text = '| A | B |\n| - | - |\n| 1 | 2 |';
  assert.equal(parseMarkdownTableColumn(text, 'File'), null);
});

test('parseMarkdownTableColumn ignores a header row without a separator row', () => {
  const text = '| File |\nnot a separator\n| `a.md` |';
  assert.equal(parseMarkdownTableColumn(text, 'File'), null);
});

test('unwrapCodeSpan strips a full-cell code span only', () => {
  assert.equal(unwrapCodeSpan('`check.md`'), 'check.md');
  assert.equal(unwrapCodeSpan('  `/pr`  '), '/pr');
  assert.equal(unwrapCodeSpan('plain text'), 'plain text');
});

test('parseSkillStreamCounts reads the tree comment counts', () => {
  const text = [
    '```text',
    'skills/',
    '├── upstream/      # 49 スキル（設計・アーキテクチャレビュー）',
    '├── midstream/     # 60 スキル（コード・実装レビュー）',
    '├── downstream/    # 8 スキル（テスト・QAレビュー）',
    '└── registry.yaml  # スキル登録',
    '```',
  ].join('\n');

  assert.deepEqual(
    [...parseSkillStreamCounts(text)],
    [
      ['upstream', 49],
      ['midstream', 60],
      ['downstream', 8],
    ]
  );
});

test('parseSkillStreamCounts returns an empty map when the marker is gone', () => {
  assert.equal(parseSkillStreamCounts('no tree here').size, 0);
});

test('parseIgnoreDirectives captures spec id and reason', () => {
  const text = '<!-- doc-enum:ignore some-spec -- 概数で十分なため -->';
  assert.deepEqual([...parseIgnoreDirectives(text)], [['some-spec', '概数で十分なため']]);
});

test('parseIgnoreDirectives records an empty reason when none is given', () => {
  assert.deepEqual(
    [...parseIgnoreDirectives('<!-- doc-enum:ignore some-spec -->')],
    [['some-spec', '']]
  );
});

test('checkDocEnumerations reports a count mismatch', async () => {
  const spec = {
    id: 'count-spec',
    doc: 'docs/skills-structure.md',
    summary: 'stream 件数',
    marker: 'tree 行',
    kind: 'counts',
    declare: () => new Map([['upstream', 1]]),
    measure: async () => new Map([['upstream', 2]]),
  };
  const { errors, checked } = await checkDocEnumerations({ specs: [spec] });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"upstream" は 1 と書かれているが実測は 2/);
});

test('checkDocEnumerations reports both directions of a name-set drift', async () => {
  const spec = {
    id: 'name-spec',
    doc: 'commands/README.md',
    summary: 'コマンド表',
    marker: '表',
    kind: 'names',
    declare: () => new Set(['a.md', 'stale.md']),
    measure: async () => new Set(['a.md', 'added.md']),
  };
  const { errors } = await checkDocEnumerations({ specs: [spec] });
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.includes('"added.md"') && e.includes('載っていない')));
  assert.ok(errors.some((e) => e.includes('"stale.md"') && e.includes('実体に存在しない')));
});

test('checkDocEnumerations fails when the declaration marker disappears', async () => {
  const spec = {
    id: 'missing-marker',
    doc: 'commands/README.md',
    summary: 'コマンド表',
    marker: '`Command | File | Purpose` 表',
    kind: 'names',
    declare: () => null,
    measure: async () => new Set(['a.md']),
  };
  const { errors, checked } = await checkDocEnumerations({
    specs: [spec, passingSpec()],
    readDoc: async () => '',
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /マーカー/);
});

test('checkDocEnumerations honours a doc-side ignore directive with a reason', async () => {
  const spec = {
    id: 'ignorable-spec',
    doc: 'docs/example.md',
    summary: 'stream 件数',
    marker: 'tree 行',
    kind: 'counts',
    declare: () => new Map([['upstream', 1]]),
    measure: async () => new Map([['upstream', 999]]),
  };

  const withoutIgnore = await checkDocEnumerations({
    specs: [spec, passingSpec()],
    readDoc: async () => 'no directive here',
  });
  assert.equal(withoutIgnore.errors.length, 1);

  const withIgnore = await checkDocEnumerations({
    specs: [spec, passingSpec()],
    readDoc: async () => '<!-- doc-enum:ignore ignorable-spec -- 概数で十分なため -->',
  });
  assert.deepEqual(withIgnore.errors, []);
  assert.equal(withIgnore.checked, 1);
  assert.deepEqual(withIgnore.skipped, ['docs/example.md [ignorable-spec]: 概数で十分なため']);
});

test('checkDocEnumerations rejects an ignore directive without a reason', async () => {
  const spec = {
    id: 'ignorable-spec',
    doc: 'docs/example.md',
    summary: 'ダミー',
    marker: 'ダミー',
    kind: 'names',
    declare: () => new Set(),
    measure: async () => new Set(),
  };
  const { errors } = await checkDocEnumerations({
    specs: [spec, passingSpec()],
    readDoc: async () => '<!-- doc-enum:ignore ignorable-spec -->',
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /理由が無い/);
});

test('checkDocEnumerations refuses to report OK when nothing was checked', async () => {
  // 緊急回避の doc-enum:ignore で全 spec が落ちると「落ちないが何も守っていない」
  // 状態になる。exit 0 で素通りさせず、最後の防波堤としてエラーにする。
  const specs = [
    { ...passingSpec('a-spec'), doc: 'docs/a.md' },
    { ...passingSpec('b-spec'), doc: 'docs/b.md' },
  ];
  const allIgnored = await checkDocEnumerations({
    specs,
    readDoc: async () =>
      '<!-- doc-enum:ignore a-spec -- 理由A -->\n<!-- doc-enum:ignore b-spec -- 理由B -->',
  });
  assert.equal(allIgnored.checked, 0);
  assert.equal(allIgnored.skipped.length, 2);
  assert.ok(allIgnored.errors.includes(NOTHING_CHECKED_ERROR));

  // 1 件でも検証していれば発火しない（= 誤検出時に ignore で逃げる道は塞がない）。
  const partiallyIgnored = await checkDocEnumerations({
    specs,
    readDoc: async () => '<!-- doc-enum:ignore a-spec -- 理由A -->',
  });
  assert.equal(partiallyIgnored.checked, 1);
  assert.deepEqual(partiallyIgnored.errors, []);

  // spec が 0 件のときは発火しない（呼び出し側の都合であって異常ではない）。
  const noSpecs = await checkDocEnumerations({ specs: [], readDoc: async () => '' });
  assert.deepEqual(noSpecs.errors, []);
});

test('checkDocEnumerations rejects an unknown kind instead of falling through to diffNames', async () => {
  const spec = {
    id: 'typo-kind',
    doc: 'docs/example.md',
    summary: 'ダミー',
    marker: 'ダミー',
    kind: 'count', // typo: 正しくは 'counts'
    declare: () => new Map([['a', 1]]),
    measure: async () => new Map([['a', 2]]),
  };
  const { errors, checked } = await checkDocEnumerations({
    specs: [spec, passingSpec()],
    readDoc: async () => '',
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /kind "count" は未知/);
});

test('checkDocEnumerations contains a throwing declare instead of aborting every spec', async () => {
  const throwing = {
    id: 'throwing-declare',
    doc: 'docs/example.md',
    summary: 'ダミー',
    marker: 'ダミー',
    kind: 'names',
    declare: () => {
      throw new Error('宣言が壊れている');
    },
    measure: async () => new Set(),
  };
  const { errors, checked } = await checkDocEnumerations({
    specs: [throwing, passingSpec()],
    readDoc: async () => '',
  });
  // 後続 spec が巻き添えで落ちない = checked が進んでいる。
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /宣言の解析に失敗した \(宣言が壊れている\)/);
});

test('checkDocEnumerations reports an expired ignoreKeys entry', async () => {
  const spec = {
    id: 'expired-ignore',
    doc: 'docs/example.md',
    summary: 'コマンド表',
    marker: '表',
    kind: 'names',
    declare: () => new Set(['a.md']),
    measure: async () => new Set(['a.md']),
    ignoreKeys: { 'removed.md': 'かつて除外していた' },
  };
  const { errors } = await checkDocEnumerations({ specs: [spec], readDoc: async () => '' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ignoreKeys\["removed\.md"\] は宣言にも実体にも存在しない/);
});

test('parseSkillStreamCounts throws when a stream count is declared twice', () => {
  const text = [
    '├── upstream/      # 49 スキル',
    '└── upstream/      # 12 スキル（別のツリー）',
  ].join('\n');
  assert.throws(() => parseSkillStreamCounts(text), /"upstream" の件数宣言が重複している/);
});

test('checkDocEnumerations surfaces a duplicate stream-count declaration as an error', async () => {
  const spec = realSpec('skills-stream-counts');
  const realText = await readRepoFile('docs/skills-structure.md');
  // 2 本目のツリー（従来形式）に件数コメントが付いた状況を再現する。
  const mutated = `${realText}\n\`\`\`text\n├── midstream/     # 3 スキル\n\`\`\`\n`;
  const { errors } = await checkDocEnumerations({
    specs: [spec, passingSpec()],
    readDoc: async (doc) => (doc === spec.doc ? mutated : ''),
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /宣言の解析に失敗した .*"midstream" の件数宣言が重複している/);
});

test('checkDocEnumerations does not silently ignore Object.prototype key names', async () => {
  // 回帰: 除外判定に素の `in` を使うと、ignoreKeys を宣言していなくても
  // toString / constructor 等が prototype 経由で「除外済み」と判定され、
  // 理由の登録なしに検証が空振りしていた。
  const namesSpec = {
    id: 'proto-key-names',
    doc: 'docs/example.md',
    summary: 'コマンド表',
    marker: '表',
    kind: 'names',
    declare: () => new Set(),
    measure: async () => new Set(['toString', 'constructor']),
  };
  const namesResult = await checkDocEnumerations({
    specs: [namesSpec],
    readDoc: async () => '',
  });
  assert.equal(namesResult.errors.length, 2);
  assert.ok(namesResult.errors.some((e) => e.includes('"toString"')));
  assert.ok(namesResult.errors.some((e) => e.includes('"constructor"')));

  const countsSpec = {
    id: 'proto-key-counts',
    doc: 'docs/example.md',
    summary: '件数',
    marker: '行',
    kind: 'counts',
    declare: () => new Map([['valueOf', 1]]),
    measure: async () => new Map([['toString', 2]]),
  };
  const countsResult = await checkDocEnumerations({
    specs: [countsSpec],
    readDoc: async () => '',
  });
  assert.equal(countsResult.errors.length, 2);
  assert.ok(countsResult.errors.some((e) => e.includes('"toString"')));
  assert.ok(countsResult.errors.some((e) => e.includes('"valueOf"')));
});

test('checkDocEnumerations supports per-key ignores declared in the spec table', async () => {
  const spec = {
    id: 'partial-ignore',
    doc: 'docs/example.md',
    summary: 'コマンド表',
    marker: '表',
    kind: 'names',
    declare: () => new Set(['a.md']),
    measure: async () => new Set(['a.md', 'experimental.md']),
    ignoreKeys: { 'experimental.md': '実験中のため意図的に未掲載' },
  };
  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => '',
  });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test('resolveIgnoreKeys accepts only entries carrying a non-empty reason', () => {
  const spec = { doc: 'docs/example.md', id: 'spec' };
  const { accepted, errors } = resolveIgnoreKeys(spec, {
    ok: '理由あり',
    empty: '',
    blank: '   ',
    wrongType: true,
  });
  assert.deepEqual(accepted, { ok: '理由あり' });
  assert.equal(errors.length, 3);
  for (const key of ['empty', 'blank', 'wrongType']) {
    assert.ok(
      errors.some((e) => e.includes(`ignoreKeys["${key}"]`)),
      `missing error for ${key}`
    );
  }
});

test('resolveIgnoreKeys tolerates a missing ignoreKeys field', () => {
  const { accepted, errors } = resolveIgnoreKeys({ doc: 'd', id: 'i' }, undefined);
  assert.deepEqual(accepted, {});
  assert.deepEqual(errors, []);
});

test('checkDocEnumerations rejects a reason-less ignoreKeys entry and still compares the key', async () => {
  const spec = {
    id: 'reasonless-ignore-key',
    doc: 'docs/example.md',
    summary: 'コマンド表',
    marker: '表',
    kind: 'names',
    declare: () => new Set(['a.md']),
    measure: async () => new Set(['a.md', 'experimental.md']),
    ignoreKeys: { 'experimental.md': '' },
  };
  const { errors } = await checkDocEnumerations({ specs: [spec], readDoc: async () => '' });
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.includes('ignoreKeys["experimental.md"] に理由が無い')));
  // 理由なしの除外は採用されないため、そのキーは通常どおり drift として報告される。
  assert.ok(errors.some((e) => e.includes('"experimental.md"') && e.includes('載っていない')));
});

test('checkDocEnumerations reports an unreadable document instead of throwing', async () => {
  const spec = {
    id: 'missing-doc',
    doc: 'docs/this-file-does-not-exist.md',
    summary: 'ダミー',
    marker: 'ダミー',
    kind: 'names',
    declare: () => new Set(),
    measure: async () => new Set(),
  };
  const { errors, checked } = await checkDocEnumerations({ specs: [spec] });
  assert.equal(checked, 0);
  assert.ok(errors.some((e) => /ドキュメントを読めない/.test(e)));
  // 1 件も検証できていないので、防波堤も同時に鳴る。
  assert.ok(errors.includes(NOTHING_CHECKED_ERROR));
});

test('every registered spec declares the fields the engine needs', () => {
  assert.ok(DOC_ENUMERATION_SPECS.length > 0);
  const ids = new Set();
  for (const spec of DOC_ENUMERATION_SPECS) {
    assert.match(spec.id, /^[a-z0-9-]+$/, `spec id must be kebab-case: ${spec.id}`);
    assert.ok(!ids.has(spec.id), `duplicate spec id: ${spec.id}`);
    ids.add(spec.id);
    assert.ok(spec.doc && spec.summary && spec.marker, `spec ${spec.id} is missing metadata`);
    assert.ok(['counts', 'names'].includes(spec.kind), `spec ${spec.id} has an unknown kind`);
    assert.equal(typeof spec.declare, 'function');
    assert.equal(typeof spec.measure, 'function');
  }
});

// --- 登録済み spec を実 doc の改変版に当てる（自己整合なテストにしないため） ---
//
// 失敗系を全部インラインの偽 spec で書くと、登録 spec の declare が実 doc の
// 「別の表」を掴んでいても集合がたまたま一致すればテストは通ってしまう
// （CLAUDE.md「Import the SSoT, never re-derive it」に記録された #1656 と同じ構図）。
// ここでは production の spec.declare / spec.measure をそのまま通し、
// 実ファイルの内容を 1 箇所だけ壊して「本当に落ちる」ことを確かめる。

test('distributed-commands-table spec fails when a real row is removed from commands/README.md', async () => {
  const spec = realSpec('distributed-commands-table');
  const realText = await readRepoFile('commands/README.md');
  // 行ごと（改行込みで）落とす。空行を残すと表がそこで終わったと解釈され、
  // 以降の行も丸ごと欠落扱いになってしまう。
  const mutated = realText.replace(/^\|\s*`\/pr`.*\r?\n/m, '');
  assert.notEqual(mutated, realText, 'fixture precondition: the `/pr` row must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /実体に "pr\.md" があるが .* に載っていない/);
});

test('claude-md-command-table spec fails when a real row is removed from CLAUDE.md', async () => {
  const spec = realSpec('claude-md-command-table');
  const realText = await readRepoFile('CLAUDE.md');
  const mutated = realText.replace(/^\|\s*`\/merge-check`.*\r?\n/m, '');
  assert.notEqual(mutated, realText, 'fixture precondition: the `/merge-check` row must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /実体に "\/merge-check" があるが .* に載っていない/);
});

test('workflows-readme-table spec fails when a real row is removed from .github/workflows/README.md', async () => {
  const spec = realSpec('workflows-readme-table');
  const realText = await readRepoFile('.github/workflows/README.md');
  const mutated = realText.replace(/^\|\s*`test\.yml`.*\r?\n/m, '');
  assert.notEqual(mutated, realText, 'fixture precondition: the `test.yml` row must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /実体に "test\.yml" があるが .* に載っていない/);
});

test('workflows-readme-table spec fails when a phantom row is added to .github/workflows/README.md', async () => {
  const spec = realSpec('workflows-readme-table');
  const realText = await readRepoFile('.github/workflows/README.md');
  // 「1 本消して 1 本足す」の「足す」側。実体の無い行が表に残ると落ちることを確かめる。
  const mutated = realText.replace(
    /^(\|\s*`test\.yml`.*\r?\n)/m,
    '| `phantom-workflow.yml` | Phantom | - | - | - |\n$1'
  );
  assert.notEqual(mutated, realText, 'fixture precondition: the `test.yml` row must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"phantom-workflow\.yml" を挙げているが実体に存在しない/);
});

test('skills-stream-counts spec fails when a real count is altered in docs/skills-structure.md', async () => {
  const spec = realSpec('skills-stream-counts');
  const realText = await readRepoFile('docs/skills-structure.md');
  const mutated = realText.replace(/([├└]──\s*upstream\/\s*#\s*)\d+(\s*スキル)/, '$1999$2');
  assert.notEqual(mutated, realText, 'fixture precondition: the upstream count line must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"upstream" は 999 と書かれているが実測は \d+/);
});

// --- ガード台帳（docs/development/guard-ledger.yaml）との照合 ---

test('parseGuardTitles reads only the AI Misoperation Guards section', () => {
  const text = [
    '## Decision Policy',
    '',
    '- **Proceed autonomously**: read-only exploration.',
    '',
    '## AI Misoperation Guards',
    '',
    '- **Read before referencing**: Do not cite file contents.',
    '- **`N of N` = bot push**: Diagnose by the head.',
    'not a bullet',
    '',
    '## Improvement Flow',
    '',
    '- **Should not be picked up**: trailing section.',
  ].join('\n');

  assert.deepEqual([...parseGuardTitles(text)], ['Read before referencing', '`N of N` = bot push']);
});

test('parseGuardTitles returns null when the section heading is gone', () => {
  assert.equal(parseGuardTitles('## Something Else\n\n- **A**: b.'), null);
});

test('parseGuardTitles returns null when the section has no guard bullets', () => {
  assert.equal(parseGuardTitles('## AI Misoperation Guards\n\nprose only\n'), null);
});

test('parseGuardTitles throws on a duplicated guard title', () => {
  const text = ['## AI Misoperation Guards', '- **Dup**: one.', '- **Dup**: two.'].join('\n');
  assert.throws(() => parseGuardTitles(text), /ガード見出し "Dup" が重複している/);
});

test('parseGuardLedger rejects malformed entries', () => {
  const base = {
    id: 'a-guard',
    title: 'A guard',
    mechanized: 'none',
    verifiedBy: [],
    addedAt: '2026-01-01',
    reviewAfter: '2026-04-01',
  };
  const dump = (guards) => JSON.stringify({ guards }); // JSON は YAML の部分集合

  assert.deepEqual(parseGuardLedger(dump([base])), [base]);

  assert.throws(() => parseGuardLedger('[]'), /トップレベルに配列/);
  assert.throws(() => parseGuardLedger(dump([{ ...base, id: 'Not Kebab' }])), /kebab-case/);
  assert.throws(() => parseGuardLedger(dump([base, base])), /id "a-guard" が重複/);
  assert.throws(
    () => parseGuardLedger(dump([base, { ...base, id: 'b-guard' }])),
    /title "A guard" が重複/
  );
  assert.throws(() => parseGuardLedger(dump([{ ...base, mechanized: 'yes' }])), /mechanized は/);
  assert.throws(
    () => parseGuardLedger(dump([{ ...base, verifiedBy: ['x'] }])),
    /mechanized: none なのに verifiedBy がある/
  );
  assert.throws(
    () => parseGuardLedger(dump([{ ...base, mechanized: 'full' }])),
    /verifiedBy に所在を 1 件以上/
  );
  assert.throws(() => parseGuardLedger(dump([{ ...base, addedAt: '2026/01/01' }])), /addedAt は/);
  assert.throws(() => parseGuardLedger(dump([{ ...base, reviewAfter: 'soon' }])), /reviewAfter は/);
});

test('the real ledger covers every guard and keeps reviewAfter on or after addedAt', async () => {
  const entries = parseGuardLedger(await readRepoFile(GUARD_LEDGER_PATH));
  const titles = parseGuardTitles(await readRepoFile('CLAUDE.md'));
  assert.ok(titles && titles.size > 0);
  assert.equal(entries.length, titles.size);
  for (const entry of entries) {
    if (entry.addedAt === 'unknown') continue;
    assert.ok(
      entry.reviewAfter >= entry.addedAt,
      `${entry.id}: reviewAfter (${entry.reviewAfter}) は addedAt (${entry.addedAt}) 以降であること`
    );
  }
});

test('claude-md-guard-ledger spec fails when a guard is removed from CLAUDE.md', async () => {
  const spec = realSpec('claude-md-guard-ledger');
  const realText = await readRepoFile('CLAUDE.md');
  const mutated = realText.replace(/^-\s+\*\*Doc-edit textlint\*\*:.*\r?\n/m, '');
  assert.notEqual(mutated, realText, 'fixture precondition: the guard bullet must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /実体に "Doc-edit textlint" があるが .* に載っていない/);
});

test('claude-md-guard-ledger spec fails when a phantom guard is added to CLAUDE.md', async () => {
  const spec = realSpec('claude-md-guard-ledger');
  const realText = await readRepoFile('CLAUDE.md');
  const mutated = realText.replace(
    /^(-\s+\*\*Doc-edit textlint\*\*:)/m,
    '- **Phantom guard**: not in the ledger.\n$1'
  );
  assert.notEqual(mutated, realText, 'fixture precondition: the guard bullet must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"Phantom guard" を挙げているが実体に存在しない/);
});

test('claude-md-guard-ledger spec reports both directions when a guard is renamed', async () => {
  const spec = realSpec('claude-md-guard-ledger');
  const realText = await readRepoFile('CLAUDE.md');
  const mutated = realText.replace(
    /^-\s+\*\*Doc-edit textlint\*\*:/m,
    '- **Doc-edit textlint (renamed)**:'
  );
  assert.notEqual(mutated, realText, 'fixture precondition: the guard bullet must exist');

  const { errors } = await checkDocEnumerations({ specs: [spec], readDoc: async () => mutated });
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.includes('"Doc-edit textlint"') && e.includes('載っていない')));
  assert.ok(
    errors.some(
      (e) => e.includes('"Doc-edit textlint (renamed)"') && e.includes('実体に存在しない')
    )
  );
});

test('guard-ledger-verified-by spec fails when a declared path does not exist', async () => {
  const spec = realSpec('guard-ledger-verified-by');
  const realText = await readRepoFile(GUARD_LEDGER_PATH);
  const mutated = realText.replace(
    /^(\s+)- \.claude\/hooks\/gh-account-guard\.sh$/m,
    '$1- .claude/hooks/does-not-exist.sh'
  );
  assert.notEqual(mutated, realText, 'fixture precondition: the verifiedBy entry must exist');

  const { errors, checked } = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => mutated,
  });
  assert.equal(checked, 1);
  // 実在しないパスは measure（disk 走査）に現れないので「実体に存在しない」側で落ちる。
  // 併せて、宣言から外れた実在パスが「載っていない」側で落ちる。
  assert.ok(
    errors.some(
      (e) => e.includes('".claude/hooks/does-not-exist.sh"') && e.includes('実体に存在しない')
    )
  );
});

test('checkDocEnumerations passes on the current repo state', async () => {
  const { errors, checked, skipped } = await checkDocEnumerations();
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
  // checked だけを spec 数と比べると、doc-enum:ignore を 1 件入れた瞬間に
  // このテストが落ち、Meta consistency の代わりに Unit tests が PR を止めてしまう。
  // ignore は「誤検出でメイン開発を止めない」ための唯一の逃げ道なので、
  // skipped を足した合計で不変条件を書く。
  assert.equal(checked + skipped.length, DOC_ENUMERATION_SPECS.length);
  for (const note of skipped) {
    assert.match(
      note,
      /^\S.*\[[a-z0-9-]+\]: \S/,
      `ignored spec must carry a reason: ${JSON.stringify(note)}`
    );
  }
});
