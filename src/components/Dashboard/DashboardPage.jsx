import React from 'react';
import CostTrends from './CostTrends';
import PhaseDistribution from './PhaseDistribution';
import ReviewStatsCard from './ReviewStatsCard';
import SkillHeatmap from './SkillHeatmap';
import { useDashboardData } from './useDashboardData';

export default function DashboardPage() {
  const data = useDashboardData();
  // Until real LLM review runs are committed, the dashboard shows the
  // deterministic, offline-verifiable Skill Registry + detector coverage.
  const hasRuns = data.totals?.reviews != null;

  return (
    <div className="container margin-vert--lg">
      <h1>River Reviewer ダッシュボード</h1>
      <p className="margin-bottom--md">
        {hasRuns
          ? 'レビュー実行回数やコストの推移を可視化します。'
          : 'スキルレジストリと決定論的検出器のカバレッジを表示します。レビュー実行回数・コストは、実際のレビュー実行が記録され次第反映されます。'}
        生成日時: {data.generatedAt || 'N/A'}
      </p>

      <ReviewStatsCard totals={data.totals} />

      <div className="row margin-top--lg">
        <div className="col col--6">
          <div className="card">
            <div className="card__header">
              <h3 className="card__title">
                {hasRuns ? 'フェーズ別レビュー数' : 'フェーズ別スキル数'}
              </h3>
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
