/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  docs: [
    'intro',
    { type: 'category', label: 'Overview', items: ['overview/what-is-ai-review'] },
    { type: 'category', label: 'Setup', items: ['setup/quickstart', 'setup/github-actions'] },
    { type: 'category', label: 'Guides', items: ['guides/authoring-checks'] },
    { type: 'category', label: 'Reference', items: ['reference/config-schema'] },
    {
      type: 'category',
      label: 'Governance',
      items: [
        'governance/CONTRIBUTING',
        'governance/WRITING_GUIDE',
        'governance/PDR/pdr-0001-site-stack',
      ],
    },
    {
      type: 'category',
      label: 'Framework',
      collapsed: false,
      items: [
        'framework/overview',
        'framework/principles',
        'framework/checklist',
        'framework/security-gauntlet',
        'framework/formal-methods',
        'framework/agents-hitl',
        'framework/conclusion',
      ],
    },
  ],
};
