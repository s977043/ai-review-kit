import React from 'react';
import CostTrends from './CostTrends';
import PhaseDistribution from './PhaseDistribution';
import ReviewStatsCard from './ReviewStatsCard';
import SkillHeatmap from './SkillHeatmap';
import { useDashboardData } from './useDashboardData';

export default function DashboardPage() {
  const data = useDashboardData();

  return (
    <div className="container margin-vert--lg">
      <h1>River Reviewer ダッシュボード</h1>
      <p className="margin-bottom--md">
        レビュー実行回数やコストの推移を可視化します。生成日時: {data.generatedAt || 'N/A'}
      </p>

      <ReviewStatsCard totals={data.totals} />

      <div className="row margin-top--lg">
        <div className="col col--6">
          <div className="card">
            <div className="card__header">
              <h3 className="card__title">フェーズ別レビュー数</h3>
            </div>
            <div className="card__body">
              <PhaseDistribution phases={data.phases} />
            </div>
          </div>
        </div>
        <div className="col col--6">
          <div className="card">
            <div className="card__header">
              <h3 className="card__title">コスト推移</h3>
            </div>
            <div className="card__body">
              <CostTrends trend={data.costTrend} />
            </div>
          </div>
        </div>
      </div>

      <div className="margin-top--lg">
        <SkillHeatmap skills={data.skills} />
      </div>
    </div>
  );
}
