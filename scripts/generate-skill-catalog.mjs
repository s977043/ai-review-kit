#!/usr/bin/env node
// Generate the user-facing skill catalog (pages/reference/skills-catalog.md).
//
// Usage:
//   node scripts/generate-skill-catalog.mjs            # write the catalog
//   node scripts/generate-skill-catalog.mjs --check    # exit 1 if stale
//
// `--check` is wired into `npm run meta:validate`, which backs the required
// `Meta consistency` check, so a skill added/removed/re-phased without
// regenerating the catalog fails CI instead of silently drifting.
//
// Formatting: the rendered markdown is run through prettier (the repo's single
// source of truth for formatting) before it is written or compared. Without
// this the raw output would differ from the committed, prettier-formatted file
// — notably the Skill Packs table, whose column padding prettier normalizes —
// and `--check` would report a permanent phantom staleness. Same rationale as
// scripts/generate-registry-fields.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import prettier from 'prettier';
import { loadSkills, loadPacks } from '../runners/core/skill-loader.mjs';
// Phase membership is decided by the production router, not re-derived here:
// `matchesPhase` is what actually selects skills at review time, so the catalog
// lists a skill under exactly the phases it really activates in.
import { matchesPhase } from '../runners/core/review-runner.mjs';
import { isDirectRun } from './lib/is-direct-run.mjs';

// docs/skills-catalog.md was removed as a duplicate; the canonical catalog lives
// under pages/reference/ (rendered on the docs site).
const OUTPUT_PATHS = [path.resolve('pages/reference/skills-catalog.md')];

const PHASES = ['upstream', 'midstream', 'downstream'];

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

  const phaseSeparator = separators?.phase ?? (textlint ? ' / ' : ', ');
  const phaseJoined = Array.isArray(meta.phase)
    ? formatJoined(meta.phase, { separator: phaseSeparator })
    : meta.phase;
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

  return `### \`${meta.id}\`
- 名前: \`${meta.name}\`
- 概要: \`${description}\`
- 対象:
${applyToLines.join('\n')}
- 重要度: ${severity}
- タグ: ${tagsJoined}
- 依存関係: ${depsJoined}
- 適用条件: phase=${phaseJoined}, inputContext=${inputContextJoined}

チェック項目の例:
- ${outputKindJoined}
`;
}

/**
 * Group skills by phase, listing a multi-phase skill under every phase it
 * activates in.
 *
 * The previous implementation used `skill.metadata.phase` directly as an object
 * key. `phase` is `string | string[]`, and an array key is stringified by `[]`
 * access: `['upstream','midstream']` becomes the key `'upstream,midstream'`,
 * which matches no bucket, so the skill was dropped without any error. Single
 * element arrays survived only because `normalizePhaseValue`
 * (runners/core/skill-loader.mjs:414-422) collapses them to a plain string
 * before the catalog ever sees them.
 */
function groupByPhase(skills) {
  const phases = Object.fromEntries(PHASES.map((phase) => [phase, []]));
  for (const skill of skills) {
    for (const phase of PHASES) {
      if (matchesPhase(skill, phase)) phases[phase].push(skill);
    }
  }
  return phases;
}

function formatPacksSection(packs) {
  if (!packs.length) return [];
  const lines = [
    '## Skill Packs',
    '',
    '梱包済みレビューナレッジの配布単位です。`--skill-set <id>` で導入できます（詳細は [Skill Pack を使う](../guides/use-skill-packs.md) を参照）。',
    '',
    '| id | name | axis | tier | skills |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const pack of packs) {
    const skills = (pack.skills ?? []).map((id) => `\`${id}\``).join(' / ');
    lines.push(`| \`${pack.id}\` | ${pack.name} | ${pack.axis} | ${pack.tier} | ${skills} |`);
  }
  lines.push('');
  return lines;
}

function renderCatalog({ grouped, packs, outputPath }) {
  const isTextlintTarget = outputPath.includes(`${path.sep}pages${path.sep}`);
  const lines = [
    '# Skills Catalog',
    '',
    'River Review に同梱されているスキル一覧です。フェーズ別に分類しています。',
    '',
    '複数のフェーズで動作するスキルは、実際に起動するフェーズすべてに掲載しています。そのため見出しの総数は同梱スキル数より多くなります。',
    '',
    ...formatPacksSection(packs),
  ];

  for (const phase of PHASES) {
    lines.push(`## ${phase}`);
    lines.push('');
    if (!grouped[phase]?.length) {
      lines.push('- なし');
      lines.push('');
      continue;
    }
    const separators = isTextlintTarget
      ? {
          phase: ' / ',
          tags: ' / ',
          dependencies: ' / ',
          inputContext: ' / ',
          outputKind: ' / ',
        }
      : {
          phase: ', ',
          tags: ', ',
          dependencies: ', ',
          inputContext: ', ',
          outputKind: ', ',
        };
    const maxDescriptionLength = isTextlintTarget ? 110 : undefined;
    [...grouped[phase]]
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

  return lines.join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const skills = await loadSkills();
  const grouped = groupByPhase(skills);
  const packs = await loadPacks();

  let stale = false;
  for (const outputPath of OUTPUT_PATHS) {
    const prettierConfig = await prettier.resolveConfig(outputPath);
    const rendered = await prettier.format(renderCatalog({ grouped, packs, outputPath }), {
      ...(prettierConfig ?? {}),
      parser: 'markdown',
    });

    if (check) {
      let current = null;
      try {
        current = await fs.readFile(outputPath, 'utf8');
      } catch {
        // missing file falls through to the stale branch
      }
      // Normalize CRLF so a Windows checkout of the committed catalog does not
      // false-positive against the LF-rendered output.
      if (current !== null && current.replaceAll('\r\n', '\n') === rendered) {
        console.log(`skills catalog is up to date: ${outputPath} (${skills.length} skills).`);
        continue;
      }
      console.error(
        `skills catalog is stale: ${outputPath}. Run \`npm run skills:catalog\` and commit it.`
      );
      stale = true;
      continue;
    }

    await fs.writeFile(outputPath, rendered, 'utf8');
    console.log(`Generated skills catalog: ${outputPath} (${skills.length} skills).`);
  }

  return stale ? 1 : 0;
}

if (isDirectRun(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error('Failed to generate skills catalog:', err);
      process.exit(1);
    }
  );
}

export { groupByPhase, renderCatalog };
