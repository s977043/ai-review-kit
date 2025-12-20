#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSkills } from '../src/lib/skill-loader.mjs';

const OUTPUT_PATHS = [
  path.resolve('docs/skills-catalog.md'),
  path.resolve('pages/reference/skills-catalog.md'),
];

function formatJoined(items, { separator }) {
  if (!items?.length) return '';
  return items.join(separator);
}

function normalizeDescription(description, { textlint, maxDescriptionLength }) {
  if (!textlint) return description;
  const normalized = description.replace(/,\s*/g, '; ');
  return wrapForTextlint(normalized, maxDescriptionLength);
}

function wrapForTextlint(text, maxLen = 110) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const token of tokens) {
    const next = current ? `${current} ${token}` : token;
    if (next.length <= maxLen) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = token;
  }
  if (current) lines.push(current);
  return lines.join('\n  ');
}

function formatSkill(skill, { textlint, separators, maxDescriptionLength }) {
  const meta = skill.metadata;
  const applyTo = Array.isArray(meta.applyTo) ? meta.applyTo : [];
  const tags = meta.tags ?? [];
  const severity = meta.severity ?? 'n/a';
  const deps = meta.dependencies ?? [];
  const inputContext = meta.inputContext ?? [];
  const outputKind = meta.outputKind ?? [];

  const tagsSeparator = separators?.tags ?? (textlint ? ' / ' : ', ');
  const depsSeparator = separators?.dependencies ?? (textlint ? ' / ' : ', ');
  const inputSeparator = separators?.inputContext ?? (textlint ? ' / ' : ', ');
  const outputSeparator = separators?.outputKind ?? (textlint ? ' / ' : ', ');
  const description = normalizeDescription(meta.description, { textlint, maxDescriptionLength });
  const tagsJoined = tags.length ? formatJoined(tags, { separator: tagsSeparator }) : 'なし';
  const depsJoined = deps.length ? formatJoined(deps, { separator: depsSeparator }) : 'none';
  const inputContextJoined = inputContext.length
    ? formatJoined(inputContext, { separator: inputSeparator })
    : 'none';
  const outputKindJoined = outputKind.length
    ? formatJoined(outputKind, { separator: outputSeparator })
    : 'レビューコメント出力';

  const applyToLines = applyTo.length ? applyTo.map((p) => `  - \`${p}\``) : ['  - (none)'];

  return `### ${meta.id}
- 名前: ${meta.name}
- 概要: ${description}
- 対象:
${applyToLines.join('\n')}
- 重要度: ${severity}
- タグ: ${tagsJoined}
- 依存関係: ${depsJoined}
- 適用条件: phase=${meta.phase}, inputContext=${inputContextJoined}

チェック項目の例:
- ${outputKindJoined}
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

  for (const outputPath of OUTPUT_PATHS) {
    const isTextlintTarget = outputPath.includes(`${path.sep}pages${path.sep}`);
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
      const separators = isTextlintTarget
        ? {
            tags: ' / ',
            dependencies: ' / ',
            inputContext: ' / ',
            outputKind: ' / ',
          }
        : {
            tags: ', ',
            dependencies: ', ',
            inputContext: ', ',
            outputKind: ', ',
          };
      const maxDescriptionLength = isTextlintTarget ? 110 : undefined;
      grouped[phase]
        .sort((a, b) => a.metadata.id.localeCompare(b.metadata.id))
        .forEach((skill) => {
          lines.push(
            formatSkill(skill, {
              textlint: isTextlintTarget,
              separators,
              maxDescriptionLength,
            })
          );
        });
      lines.push('');
    }

    await fs.writeFile(outputPath, lines.join('\n'), 'utf8');
    console.log(`Generated skills catalog: ${outputPath}`);
  }
}

main().catch((err) => {
  console.error('Failed to generate skills catalog:', err);
  process.exitCode = 1;
});
