const fs = require('fs/promises');
const path = require('path');

module.exports = function riverDashboardPlugin(context, options = {}) {
  const dataPath =
    options.dataPath ?? path.join(context.siteDir, 'docs', 'data', 'dashboard-stats.json');

  return {
    name: 'river-dashboard',
    async loadContent() {
      try {
        const raw = await fs.readFile(dataPath, 'utf8');
        return JSON.parse(raw);
      } catch (error) {
        console.warn(`[river-dashboard] Failed to read data: ${error.message}`);
        return {
          generatedAt: new Date().toISOString(),
          totals: {},
          phases: [],
          skills: [],
          costTrend: [],
        };
      }
    },
    async contentLoaded({ content, actions }) {
      actions.setGlobalData(content);
    },
  };
};
