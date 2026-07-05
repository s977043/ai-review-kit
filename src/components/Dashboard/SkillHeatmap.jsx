import React from 'react';

export default function SkillHeatmap({ skills }) {
  if (!skills?.length) {
    return <p>スキル別の指摘データがまだありません。</p>;
  }

  // Real run artifacts carry a per-skill `findings` count; the offline default
  // carries `detectors` (deterministic checks each heuristic skill provides).
  const metric = (skill) => skill.findings ?? skill.detectors ?? 0;
  const isCoverage = skills[0]?.findings == null;
  const sorted = [...skills].sort((a, b) => metric(b) - metric(a));

  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">{isCoverage ? 'Detector coverage' : 'Skill findings'}</h3>
        <p className="card__subtitle">
          {isCoverage
            ? 'ヒューリスティックスキルが備える決定論的検出器の数（オフラインで再現可能）。'
            : '頻度の高い指摘スキルを表示します。'}
        </p>
      </div>
      <div className="card__body">
        <table className="table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>{isCoverage ? 'Detectors' : 'Findings'}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((skill) => (
              <tr key={skill.id}>
                <td>{skill.name || skill.id}</td>
                <td>{metric(skill)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
