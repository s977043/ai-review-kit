import React from 'react';

export default function SkillHeatmap({ skills }) {
  if (!skills?.length) {
    return <p>スキル別の指摘データがまだありません。</p>;
  }

  const sorted = [...skills].sort((a, b) => (b.findings ?? 0) - (a.findings ?? 0));

  return (
    <div className="card">
      <div className="card__header">
        <h3 className="card__title">Skill findings</h3>
        <p className="card__subtitle">頻度の高い指摘スキルを表示します。</p>
      </div>
      <div className="card__body">
        <table className="table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Findings</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((skill) => (
              <tr key={skill.id}>
                <td>{skill.name || skill.id}</td>
                <td>{skill.findings ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
