#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const resvgVersion = require('@resvg/resvg-js/package.json').version;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const defaultOutputDir = join(repoRoot, 'dist', 'social');

const args = process.argv.slice(2);
const outputDir = resolve(
  repoRoot,
  readOption(args, '--out') ?? readOption(args, '-o') ?? defaultOutputDir,
);

const brandBackground = '#0b1f33';

const assets = [
  {
    name: 'GitHub Social Preview',
    source: 'assets/social/social-preview.svg',
    output: 'github-social-preview.png',
    width: 1280,
    height: 640,
    mode: 'contain',
  },
  {
    name: 'X post image',
    source: 'assets/social/social-preview.svg',
    output: 'x-post.png',
    width: 1200,
    height: 675,
    mode: 'cover',
  },
  {
    name: 'Zenn / note hero',
    source: 'assets/social/diagram.svg',
    output: 'zenn-note-hero.png',
    width: 1200,
    height: 630,
    mode: 'contain',
  },
];

await mkdir(outputDir, { recursive: true });

for (const asset of assets) {
  const sourcePath = join(repoRoot, asset.source);
  const svg = await readFile(sourcePath, 'utf8');
  const wrappedSvg = wrapSvg(svg, asset);
  const png = renderPng(wrappedSvg);
  const outputPath = join(outputDir, asset.output);

  await writeFile(outputPath, png);

  console.log(
    `${asset.name}: ${asset.width}x${asset.height} ${asset.source} -> ${relativeFromRepo(outputPath)}`,
  );
}

console.log(`Renderer: @resvg/resvg-js ${resvgVersion}`);
console.log(
  'Font handling: loadSystemFonts=true; SVG font-family keeps Inter, Segoe UI, sans-serif fallback.',
);

function renderPng(svg) {
  const renderer = new Resvg(svg, {
    background: brandBackground,
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Inter',
    },
  });

  return renderer.render().asPng();
}

function wrapSvg(svg, asset) {
  const { viewBox, inner } = extractSvg(svg, asset.source);
  const [sourceX, sourceY, sourceWidth, sourceHeight] = viewBox;
  const scale =
    asset.mode === 'cover'
      ? Math.max(asset.width / sourceWidth, asset.height / sourceHeight)
      : Math.min(asset.width / sourceWidth, asset.height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const x = (asset.width - renderedWidth) / 2;
  const y = (asset.height - renderedHeight) / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}" viewBox="0 0 ${asset.width} ${asset.height}" role="img">
  <rect width="${asset.width}" height="${asset.height}" fill="${brandBackground}" />
  <svg x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(renderedWidth)}" height="${formatNumber(renderedHeight)}" viewBox="${sourceX} ${sourceY} ${sourceWidth} ${sourceHeight}">
${inner}
  </svg>
</svg>`;
}

function extractSvg(svg, source) {
  const viewBoxMatch = svg.match(/<svg\b[^>]*viewBox="([^"]+)"[^>]*>/i);
  if (!viewBoxMatch) {
    throw new Error(`${source}: missing SVG viewBox`);
  }

  const viewBox = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4 || viewBox.some((value) => Number.isNaN(value))) {
    throw new Error(`${source}: invalid SVG viewBox: ${viewBoxMatch[1]}`);
  }

  const openTagEnd = svg.indexOf('>', svg.indexOf('<svg'));
  const closeTagStart = svg.lastIndexOf('</svg>');
  if (
    openTagEnd === -1 ||
    closeTagStart === -1 ||
    closeTagStart <= openTagEnd
  ) {
    throw new Error(`${source}: invalid SVG document`);
  }

  return {
    viewBox,
    inner: svg.slice(openTagEnd + 1, closeTagStart).trim(),
  };
}

function readOption(argv, optionName) {
  const index = argv.indexOf(optionName);
  if (index === -1) return null;

  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${optionName} requires a value`);
  }

  return value;
}

function formatNumber(value) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function relativeFromRepo(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}
