/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
module.exports = {
  docs: [
    {
      type: 'category',
      label: 'Tutorials',
      items: [
        'tutorials/getting-started',
        'tutorials/creating-your-first-skill',
        'tutorials/authoring-skills',
        'tutorials/integrating-with-github-actions',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/quickstart',
        'guides/github-actions',
        'guides/run-phase-specific-review',
        'guides/validate-skill-schema',
        'guides/debug-skill-routing',
        'guides/use-riverbed-memory',
        'guides/tracing',
        'guides/agents',
        {
          type: 'category',
          label: 'Governance',
          items: [
            'guides/governance/CONTRIBUTING',
            'guides/governance/WRITING_GUIDE',
            'guides/governance/roadmap-guide',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/skill-schema',
        'reference/skill-schema-reference',
        'reference/config-schema',
        'reference/metadata-fields',
        'reference/runner-cli-reference',
        'reference/glossary',
      ],
    },
    {
      type: 'category',
      label: 'Explanation',
      items: [
        'explanation/intro',
        'explanation/what-is-river-reviewer',
        'explanation/river-architecture',
        'explanation/design-philosophy',
        'explanation/upstream-midstream-downstream',
        'explanation/riverbed-memory',
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
  ],
};
