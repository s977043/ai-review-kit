/** @type {import('@docusaurus/types').Config} */
const SITE_URL = process.env.SITE_URL || 'https://ai-review-kit.vercel.app';

module.exports = {
  title: 'AI Review Kit',
  url: SITE_URL,
  baseUrl: '/',
  organizationName: 's977043',
  projectName: 'ai-review-kit',
  trailingSlash: false,
  i18n: { defaultLocale: 'ja', locales: ['ja'] },
  presets: [
    ['@docusaurus/preset-classic',
      {
        docs: { sidebarPath: require.resolve('./sidebars.js') },
        theme: { customCss: require.resolve('./src/css/custom.css') },
        sitemap: { changefreq: 'weekly', priority: 0.5 }
      }
    ]
  ],
  themeConfig: {
    navbar: {
      title: 'AI Review Kit',
      items: [
        { to: '/docs/intro', label: 'Docs', position: 'left' },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} AI Review Kit`,
    },
  },
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
};
