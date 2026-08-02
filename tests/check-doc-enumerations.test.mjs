import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOC_ENUMERATION_SPECS,
  checkDocEnumerations,
  parseIgnoreDirectives,
  parseMarkdownTableColumn,
  parseSkillStreamCounts,
  resolveIgnoreKeys,
  unwrapCodeSpan,
} from '../scripts/check-doc-enumerations.mjs';

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
  const { errors, checked } = await checkDocEnumerations({ specs: [spec] });
  assert.equal(checked, 0);
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
    specs: [spec],
    readDoc: async () => 'no directive here',
  });
  assert.equal(withoutIgnore.errors.length, 1);

  const withIgnore = await checkDocEnumerations({
    specs: [spec],
    readDoc: async () => '<!-- doc-enum:ignore ignorable-spec -- 概数で十分なため -->',
  });
  assert.deepEqual(withIgnore.errors, []);
  assert.equal(withIgnore.checked, 0);
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
    specs: [spec],
    readDoc: async () => '<!-- doc-enum:ignore ignorable-spec -->',
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /理由が無い/);
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
  const { errors } = await checkDocEnumerations({ specs: [spec] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ドキュメントを読めない/);
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

test('checkDocEnumerations passes on the current repo state', async () => {
  const { errors, checked } = await checkDocEnumerations();
  assert.deepEqual(errors, [], `Expected no errors but got: ${errors.join(', ')}`);
  assert.equal(checked, DOC_ENUMERATION_SPECS.length);
});
