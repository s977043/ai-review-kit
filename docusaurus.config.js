/** @type {import('@docusaurus/types').Config} */
// Vercelの環境変数をチェックし、デプロイ先に応じたURLとbaseUrlを動的に設定
const siteUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://s977043.github.io';
const baseUrl = process.env.VERCEL_URL ? '/' : '/river-reviewer/';

module.exports = {
  title: 'River Reviewer',
  url: siteUrl,
  baseUrl: baseUrl,
  organizationName: 's977043',
  projectName: 'river-reviewer',
  trailingSlash: false,
  i18n: { defaultLocale: 'ja', locales: ['ja'] },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: { sidebarPath: require.resolve('./sidebars.js') },
        theme: { customCss: require.resolve('./src/css/custom.css') },
        sitemap: { changefreq: 'weekly', priority: 0.5 },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'River Reviewer',
      items: [{ to: '/docs/explanation/intro', label: 'Docs', position: 'left' }],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} River Reviewer`,
    },
  },
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
};
