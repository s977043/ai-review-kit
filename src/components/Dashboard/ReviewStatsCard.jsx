import React from 'react';

function Stat({ label, value }) {
  return (
    <div className="card margin-bottom--sm">
      <div className="card__body">
        <p className="margin-vert--xs text--uppercase text--center">{label}</p>
        <p className="text--center" style={{ fontSize: '1.8rem', fontWeight: 600 }}>
          {value}
        </p>
      </div>
    </div>
  );
}

export default function ReviewStatsCard({ totals }) {
  // When real run artifacts exist, `totals` carries operational metrics
  // (reviews / cost). Until then it carries the deterministic, offline-real
  // registry + detector facts. Render whichever shape is present.
  const hasRuns = totals?.reviews != null;
  const stats = hasRuns
    ? [
        { label: 'Reviews', value: totals?.reviews ?? 0 },
        { label: 'Files reviewed', value: totals?.filesReviewed ?? 0 },
        { label: 'Comments', value: totals?.comments ?? 0 },
        {
          label: 'Avg cost (USD)',
          value: totals?.averageCostUsd ? `$${totals.averageCostUsd.toFixed(4)}` : '$0.0000',
        },
      ]
    : [
        { label: 'Skills', value: totals?.skills ?? 0 },
        { label: 'Heuristic skills', value: totals?.heuristicSkills ?? 0 },
        { label: 'Deterministic detectors', value: totals?.heuristicDetectors ?? 0 },
      ];

  return (
    <div className="row">
      {stats.map((stat) => (
        <div key={stat.label} className="col col--3">
          <Stat label={stat.label} value={stat.value} />
        </div>
      ))}
    </div>
  );
}
