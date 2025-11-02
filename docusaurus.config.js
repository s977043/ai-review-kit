/** @type {import('@docusaurus/types').Config} */
// Vercelの環境変数をチェックし、デプロイ先に応じたURLとbaseUrlを動的に設定
const siteUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://s977043.github.io';
const baseUrl = process.env.VERCEL_URL ? '/' : '/ai-review-kit/';

module.exports = {
  title: 'AI Review Kit',
  url: siteUrl,
  baseUrl: baseUrl,
  organizationName: 's977043',
  projectName: 'ai-review-kit',
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
      title: 'AI Review Kit',
      items: [{ to: '/docs/intro', label: 'Docs', position: 'left' }],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} AI Review Kit`,
    },
  },
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
};
