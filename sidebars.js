/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Explanation',
      items: [
        'what-is-river-reviewer',
        {
          type: 'category',
          label: 'Framework',
          items: [
            'overview',
            'principles',
            'checklist',
            'security-gauntlet',
            'formal-methods',
            'agents-hitl',
            'conclusion',
          ],
        },
      ],
    },
    { type: 'category', label: 'Tutorials', items: ['authoring-skills'] },
    {
      type: 'category',
      label: 'How-to',
      items: ['quickstart', 'github-actions', 'tracing'],
    },
    { type: 'category', label: 'Reference', items: ['config-schema'] },
    {
      type: 'category',
      label: 'Governance',
      items: ['governance/CONTRIBUTING', 'governance/WRITING_GUIDE'],
    },
  ],
};
