function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extOf(file) {
  const idx = file.lastIndexOf('.');
  if (idx < 0) return '';
  return file.slice(idx + 1).toLowerCase();
}

function containsSegment(file, segment) {
  const normalized = file.replaceAll('\\', '/');
  return normalized.split('/').includes(segment);
}

function matchesAny(file, needles) {
  const normalized = file.toLowerCase();
  return needles.some(n => normalized.includes(n));
}

/**
 * Infer impact tags from changed file paths.
 * Tags are intentionally small and map to existing `skills/**` tags.
 * @param {string[]|string} changedFiles
 * @param {{diffText?: string}} [options]
 * @returns {string[]}
 */
export function inferImpactTags(changedFiles, options = {}) {
  const files = ensureArray(changedFiles);
  const tags = new Set();

  for (const file of files) {
    const ext = extOf(file);

    if (['ts', 'tsx', 'cts', 'mts'].includes(ext)) tags.add('typescript');
    if (['js', 'jsx', 'cjs', 'mjs'].includes(ext)) tags.add('javascript');
    if (['md', 'mdx', 'adr'].includes(ext) || matchesAny(file, ['/docs/', '/design/']) || containsSegment(file, 'docs')) {
      tags.add('design');
    }

    if (
      containsSegment(file, 'tests') ||
      containsSegment(file, 'test') ||
      containsSegment(file, '__tests__') ||
      matchesAny(file, ['.test.', '.spec.'])
    ) {
      tags.add('tests');
    }

    if (containsSegment(file, 'api') || containsSegment(file, 'routes')) tags.add('api');
    if (containsSegment(file, 'db') || matchesAny(file, ['/migrations/', '/schema/'])) tags.add('reliability');

    if (
      containsSegment(file, 'auth') ||
      containsSegment(file, 'security') ||
      matchesAny(file, ['/oauth', '/jwt', '/session', '/cookie', '/csrf'])
    ) {
      tags.add('security');
    }

    if (
      tags.has('api') ||
      containsSegment(file, 'config') ||
      containsSegment(file, 'db') ||
      matchesAny(file, ['/env', '/secrets', '/headers'])
    ) {
      tags.add('security');
    }

    if (containsSegment(file, 'logging') || matchesAny(file, ['/logger', '/trace', '/tracing', '/otel', 'opentelemetry'])) {
      tags.add('observability');
      tags.add('reliability');
    }
  }

  const diffText = options?.diffText;
  if (typeof diffText === 'string' && diffText.length) {
    const lower = diffText.toLowerCase();
    const hasCatch = lower.includes('catch (') || lower.includes('catch(');
    const addsSilentReturn =
      /^\+.*\breturn\s*;\s*(?:\/\/.*)?$/m.test(diffText) || /^\+.*\breturn\s+null\s*;\s*(?:\/\/.*)?$/m.test(diffText);
    const mentionsIgnore = lower.includes('ignore') || lower.includes('swallow');
    if (hasCatch && (addsSilentReturn || mentionsIgnore)) {
      tags.add('observability');
      tags.add('reliability');
    }
  }

  return [...tags].sort();
}
