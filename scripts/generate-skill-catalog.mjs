#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSkills } from '../src/lib/skill-loader.mjs';

const OUTPUT_PATH = path.resolve('docs/skills-catalog.md');

function formatSkill(skill) {
  const meta = skill.metadata;
  const applyTo = Array.isArray(meta.applyTo) ? meta.applyTo.join(', ') : '';
  const tags = meta.tags?.join(', ') ?? '';
  const severity = meta.severity ?? 'n/a';
  const deps = meta.dependencies?.join(', ') ?? 'none';
  return `### ${meta.id}
- 名前: ${meta.name}
- 概要: ${meta.description}
- 対象: ${applyTo}
- 重要度: ${severity}
- タグ: ${tags || 'なし'}
- 依存関係: ${deps}
- 適用条件: phase=${meta.phase}, inputContext=${meta.inputContext?.join(', ') || 'none'}

チェック項目の例:
- ${meta.outputKind?.join(', ') || 'レビューコメント出力'}
`;
}

function groupByPhase(skills) {
  const phases = { upstream: [], midstream: [], downstream: [] };
  for (const skill of skills) {
    const phase = skill.metadata.phase;
    if (phases[phase]) phases[phase].push(skill);
  }
  return phases;
}

async function main() {
  const skills = await loadSkills();
  const grouped = groupByPhase(skills);

  const lines = [
    '# Skills Catalog',
    '',
    'River Reviewer に同梱されているスキル一覧です。フェーズ別に分類しています。',
    '',
  ];

  for (const phase of ['upstream', 'midstream', 'downstream']) {
    lines.push(`## ${phase}`);
    lines.push('');
    if (!grouped[phase]?.length) {
      lines.push('- なし');
      lines.push('');
      continue;
    }
    grouped[phase]
      .sort((a, b) => a.metadata.id.localeCompare(b.metadata.id))
      .forEach(skill => {
        lines.push(formatSkill(skill));
      });
    lines.push('');
  }

  await fs.writeFile(OUTPUT_PATH, lines.join('\n'), 'utf8');
  console.log(`Generated skills catalog: ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Failed to generate skills catalog:', err);
  process.exitCode = 1;
});
