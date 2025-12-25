/** @type {import('@docusaurus/types').Config} */
const isVercel = Boolean(process.env.VERCEL);
const normalizeSiteUrl = (url) => url.replace(/\/+$/, '');
const ensureLeadingAndTrailingSlash = (value) => {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
};
const resolveBaseUrl = () =>
  process.env.DOCS_BASE_URL || (isVercel ? '/docs/' : '/river-reviewer/');
const resolveSiteUrl = () => {
  if (process.env.DOCS_SITE_URL) return process.env.DOCS_SITE_URL;
  if (isVercel) return 'https://river-reviewer.vercel.app';
  return 'https://s977043.github.io';
};

const siteUrl = normalizeSiteUrl(resolveSiteUrl());
const baseUrl = ensureLeadingAndTrailingSlash(resolveBaseUrl());
const docsRouteBasePath =
  process.env.DOCS_ROUTE_BASE_PATH ?? (baseUrl.endsWith('/docs/') ? '/' : 'docs');

module.exports = {
  title: 'River Reviewer',
  url: siteUrl,
  baseUrl: baseUrl,
  organizationName: 's977043',
  projectName: 'river-reviewer',
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
        },
        theme: { customCss: require.resolve('./src/css/custom.css') },
        sitemap: { changefreq: 'weekly', priority: 0.5 },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'River Reviewer',
      items: [{ type: 'doc', docId: 'index', label: 'Docs', position: 'left' }],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} River Reviewer`,
    },
  },
  markdown: { mermaid: true, hooks: { onBrokenMarkdownLinks: 'throw' } },
  onBrokenLinks: 'throw',
  plugins: [
    [require.resolve('./plugins/river-dashboard'), { dataPath: 'docs/data/dashboard-stats.json' }],
  ],
  customFields: { docsRouteBasePath },
};
