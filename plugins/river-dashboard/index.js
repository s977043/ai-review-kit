const fs = require('fs/promises');
const path = require('path');

function validateData(data) {
  const defaults = {
    generatedAt: new Date().toISOString(),
    totals: {},
    phases: [],
    skills: [],
    costTrend: [],
  };

  const result = { ...defaults, ...data };

  if (typeof result.totals !== 'object' || Array.isArray(result.totals) || result.totals === null) {
    console.warn('[river-dashboard] Invalid totals, using empty object.');
    result.totals = {};
  }
  if (!Array.isArray(result.phases)) {
    console.warn('[river-dashboard] Invalid phases, using empty array.');
    result.phases = [];
  }
  if (!Array.isArray(result.skills)) {
    console.warn('[river-dashboard] Invalid skills, using empty array.');
    result.skills = [];
  }
  if (!Array.isArray(result.costTrend)) {
    console.warn('[river-dashboard] Invalid costTrend, using empty array.');
    result.costTrend = [];
  }

  return result;
}

module.exports = function riverDashboardPlugin(context, options = {}) {
  const dataPath =
    options.dataPath ?? path.join(context.siteDir, 'docs', 'data', 'dashboard-stats.json');

  return {
    name: 'river-dashboard',
    async loadContent() {
      try {
        const raw = await fs.readFile(dataPath, 'utf8');
        const parsed = JSON.parse(raw);
        return validateData(parsed);
      } catch (error) {
        console.warn(`[river-dashboard] Failed to read data: ${error.message}`);
        return validateData({});
      }
    },
    async contentLoaded({ content, actions }) {
      actions.setGlobalData(content);
    },
  };
};
