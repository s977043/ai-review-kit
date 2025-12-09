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
  const stats = [
    { label: 'Reviews', value: totals?.reviews ?? 0 },
    { label: 'Files reviewed', value: totals?.filesReviewed ?? 0 },
    { label: 'Comments', value: totals?.comments ?? 0 },
    {
      label: 'Avg cost (USD)',
      value: totals?.averageCostUsd ? `$${totals.averageCostUsd.toFixed(4)}` : '$0.0000',
    },
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
