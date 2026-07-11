/**
 * Direct tests for listSkillPackageDirs in runners/core/skill-loader.mjs.
 *
 * This is the shared lower layer for the manifest generator (findSkillDirs) and
 * the agent-skills validator's package discovery. These tests pin behavior the
 * callers rely on but did not previously cover directly:
 *   - symlink following (F-2 canary): a SKILL.md reached through a symlink, or a
 *     package directory that is itself a symlink, must still be discovered. This
 *     restores the fs.stat-based behavior of the former validate-agent-skills.
 *   - the `includeRoot: false` container-scan path (non-descent into root itself)
 *   - prefix-sibling ordering: the function returns UNSORTED results so each
 *     caller applies the sort its output contract requires; sorting parent dirs
 *     and sorting SKILL.md paths diverge when one sibling name is a prefix of
 *     another.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { listSkillPackageDirs } from '../runners/core/skill-loader.mjs';
import { withTempDir } from './helpers/temp-dir.mjs';

const TMP_PREFIX = 'skill-package-dirs-';

async function writeSkillMd(dir) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), '# skill\n', 'utf8');
}

test('detects both a real SKILL.md and a symlinked SKILL.md (F-2 canary)', async () => {
  await withTempDir(
    async (root) => {
      // pkg-real/SKILL.md is a regular file.
      await writeSkillMd(path.join(root, 'pkg-real'));
      // pkg-symlink/SKILL.md is a symlink pointing at the real SKILL.md.
      await fs.mkdir(path.join(root, 'pkg-symlink'), { recursive: true });
      await fs.symlink(
        path.join('..', 'pkg-real', 'SKILL.md'),
        path.join(root, 'pkg-symlink', 'SKILL.md')
      );

      const dirs = (await listSkillPackageDirs(root)).sort();
      assert.deepEqual(dirs, [path.join(root, 'pkg-real'), path.join(root, 'pkg-symlink')]);
    },
    { prefix: TMP_PREFIX }
  );
});

test('follows a package directory that is itself a symlink', async () => {
  await withTempDir(
    async (root) => {
      // real-pkg/SKILL.md lives outside the scanned container...
      await writeSkillMd(path.join(root, 'store', 'real-pkg'));
      // ...and linked-pkg is a symlink to that directory inside the container.
      await fs.mkdir(path.join(root, 'container'), { recursive: true });
      await fs.symlink(
        path.join('..', 'store', 'real-pkg'),
        path.join(root, 'container', 'linked-pkg'),
        'dir' // explicit type for Windows compatibility
      );

      const dirs = await listSkillPackageDirs(path.join(root, 'container'));
      assert.deepEqual(dirs, [path.join(root, 'container', 'linked-pkg')]);
    },
    { prefix: TMP_PREFIX }
  );
});

test('ignores a broken (dangling) SKILL.md symlink', async () => {
  await withTempDir(
    async (root) => {
      await fs.mkdir(path.join(root, 'broken'), { recursive: true });
      await fs.symlink(
        path.join('..', 'does-not-exist', 'SKILL.md'),
        path.join(root, 'broken', 'SKILL.md')
      );
      const dirs = await listSkillPackageDirs(root);
      assert.deepEqual(dirs, []);
    },
    { prefix: TMP_PREFIX }
  );
});

test('includeRoot: false does not treat the root itself as a package', async () => {
  await withTempDir(
    async (root) => {
      // Root directly holds a SKILL.md, but includeRoot:false must skip it and
      // scan only immediate child directories (the agent-skills container case).
      await fs.writeFile(path.join(root, 'SKILL.md'), '# root skill\n', 'utf8');
      await writeSkillMd(path.join(root, 'child'));

      const withRoot = (await listSkillPackageDirs(root, { includeRoot: true })).sort();
      assert.deepEqual(withRoot, [root]);

      const withoutRoot = (await listSkillPackageDirs(root, { includeRoot: false })).sort();
      assert.deepEqual(withoutRoot, [path.join(root, 'child')]);
    },
    { prefix: TMP_PREFIX }
  );
});

test('includeRoot: false does not descend past a child SKILL.md (non-descent)', async () => {
  await withTempDir(
    async (root) => {
      await writeSkillMd(path.join(root, 'pkg'));
      // A nested SKILL.md under the package (e.g. under fixtures/) must not create
      // a second entry.
      await writeSkillMd(path.join(root, 'pkg', 'fixtures'));

      const dirs = await listSkillPackageDirs(root, { includeRoot: false });
      assert.deepEqual(dirs, [path.join(root, 'pkg')]);
    },
    { prefix: TMP_PREFIX }
  );
});

test('prefix-sibling ordering: caller sort of parent dirs vs SKILL.md paths diverge (pin)', async () => {
  await withTempDir(
    async (root) => {
      // "pkg" is a prefix of "pkg-extra"; "-" (0x2d) < "/" (0x2f), so sorting the
      // SKILL.md paths flips the order relative to sorting the parent dirs.
      await writeSkillMd(path.join(root, 'pkg'));
      await writeSkillMd(path.join(root, 'pkg-extra'));

      const dirs = await listSkillPackageDirs(root);

      // Manifest generator style: sort the parent directory paths.
      const byDir = [...dirs].sort();
      assert.deepEqual(byDir, [path.join(root, 'pkg'), path.join(root, 'pkg-extra')]);

      // agent-skills validator style: map to SKILL.md then sort — order flips.
      const bySkillMd = dirs.map((dir) => path.join(dir, 'SKILL.md')).sort();
      assert.deepEqual(bySkillMd, [
        path.join(root, 'pkg-extra', 'SKILL.md'),
        path.join(root, 'pkg', 'SKILL.md'),
      ]);
    },
    { prefix: TMP_PREFIX }
  );
});
