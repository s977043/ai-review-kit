/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  docs: [
    'explanation/intro',
    {
      type: 'category',
      label: 'Explanation',
      items: [
        'explanation/what-is-river-reviewer',
        {
          type: 'category',
          label: 'Framework',
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
    { type: 'category', label: 'Tutorials', items: ['tutorials/authoring-skills'] },
    {
      type: 'category',
      label: 'How-to',
      items: ['how-to/quickstart', 'how-to/github-actions', 'how-to/tracing'],
    },
    { type: 'category', label: 'Reference', items: ['reference/config-schema'] },
    {
      type: 'category',
      label: 'Governance',
      items: ['governance/CONTRIBUTING', 'governance/WRITING_GUIDE'],
    },
  ],
};
