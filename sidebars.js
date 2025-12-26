/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  docs: [
    'index',
    'dashboard',
    {
      type: 'category',
      label: 'チュートリアル',
      items: [
        'tutorials/getting-started',
        'tutorials/creating-your-first-skill',
        'tutorials/authoring-skills',
        'tutorials/integrating-with-github-actions',
      ],
    },
    {
      type: 'category',
      label: 'ガイド',
      items: [
        'guides/quickstart',
        'guides/github-actions',
        'guides/run-phase-specific-review',
        'guides/validate-skill-schema',
        'guides/debug-skill-routing',
        'guides/use-riverbed-memory',
        'guides/tracing',
        'guides/agents',
        'guides/deploy-docs-vercel',
        'guides/troubleshooting',
        {
          type: 'category',
          label: 'ガバナンス',
          items: [
            'guides/governance/CONTRIBUTING',
            'guides/governance/WRITING_GUIDE',
            'guides/governance/roadmap-guide',
            'guides/governance/issue-management',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'コントリビューション',
      items: ['contributing/commit-summary', 'contributing/review-checklist'],
    },
    {
      type: 'category',
      label: 'メンテナ用',
      items: ['maintainers/continuity'],
    },
    {
      type: 'category',
      label: 'リファレンス',
      items: [
        'reference/skill-schema',
        'reference/skill-schema-reference',
        'reference/config-schema',
        'reference/metadata-fields',
        'reference/skill-template',
        'reference/runner-cli-reference',
        'reference/known-limitations',
        'reference/glossary',
      ],
    },
    {
      type: 'category',
      label: '解説',
      items: [
        'explanation/intro',
        'explanation/what-is-river-reviewer',
        'explanation/river-architecture',
        'explanation/design-philosophy',
        'explanation/upstream-midstream-downstream',
        'explanation/riverbed-memory',
        {
          type: 'category',
          label: 'フレームワーク',
          items: [
            'explanation/framework/overview',
            'explanation/framework/principles',
            'explanation/framework/checklist',
            'explanation/framework/security-gauntlet',
            'explanation/framework/formal-methods',
            'explanation/framework/agents-hitl',
            'explanation/framework/conclusion',
          ],
        },
      ],
    },
  ],
};
