/** @type {import('@docusaurus/types').Config} */
const organizationName = 's977043';
const projectName = 'river-review';
const isVercel = Boolean(process.env.VERCEL);
const normalizeSiteUrl = (url) => url.replace(/\/+$/, '');
const ensureLeadingAndTrailingSlash = (value) => {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
};
const resolveBaseUrl = () => process.env.DOCS_BASE_URL || (isVercel ? '/' : '/river-review/');
const resolveSiteUrl = () => {
  if (process.env.DOCS_SITE_URL) return process.env.DOCS_SITE_URL;
  if (isVercel) {
    if (process.env.VERCEL_ENV === 'production') return 'https://river-review.the3396.com';
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return 'https://river-review.the3396.com';
  }
  return 'https://s977043.github.io';
};

const siteUrl = normalizeSiteUrl(resolveSiteUrl());
const baseUrl = ensureLeadingAndTrailingSlash(resolveBaseUrl());
const docsRouteBasePath = process.env.DOCS_ROUTE_BASE_PATH ?? '/';

// schema.org structured data (SoftwareApplication) for search engines and AI
// crawlers. Version is intentionally omitted to avoid drift; the canonical
// version lives in CITATION.cff / package.json.
const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'River Review',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Cross-platform',
  description:
    "River Review is an open-source 'Review Judgment as Code' framework for AI-assisted code review: teams codify their review standards as versioned, repo-owned skills and run them across plans, diffs, tests, JUnit, and prior review artifacts. Human-in-the-loop, not auto-merge.",
  url: 'https://river-review.the3396.com/',
  codeRepository: 'https://github.com/s977043/river-review',
  license: 'https://opensource.org/licenses/MIT',
  isAccessibleForFree: true,
  keywords:
    'AI code review, code review, review judgment as code, skill registry, human-in-the-loop, GitHub Action, Claude Code plugin',
  offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  author: {
    '@type': 'Organization',
    name: 'River Review maintainers',
    url: 'https://github.com/s977043/river-review',
  },
};

module.exports = {
  title: 'River Review',
  url: siteUrl,
  baseUrl: baseUrl,
  organizationName,
  projectName,
  trailingSlash: true,
  i18n: { defaultLocale: 'ja', locales: ['ja'] },
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          path: 'pages',
          routeBasePath: docsRouteBasePath,
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: `https://github.com/${organizationName}/${projectName}/tree/main/`,
        },
        theme: { customCss: require.resolve('./src/css/custom.css') },
        sitemap: { changefreq: 'weekly', priority: 0.5 },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'River Review',
      items: [],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} River Review`,
    },
  },
  markdown: { mermaid: true, hooks: { onBrokenMarkdownLinks: 'throw' } },
  onBrokenLinks: 'throw',
  headTags: [
    {
      tagName: 'script',
      attributes: { type: 'application/ld+json' },
      innerHTML: JSON.stringify(structuredData),
    },
  ],
  plugins: [
    [require.resolve('./plugins/river-dashboard'), { dataPath: 'docs/data/dashboard-stats.json' }],
  ],
  customFields: { docsRouteBasePath },
};
