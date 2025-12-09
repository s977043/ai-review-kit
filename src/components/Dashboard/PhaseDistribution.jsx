import BrowserOnly from '@docusaurus/BrowserOnly';
import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function PhaseDistribution({ phases }) {
  if (!phases?.length) {
    return <p>フェーズ別のデータがまだありません。</p>;
  }

  return (
    <BrowserOnly fallback={<p>Chart is loading...</p>}>
      {() => (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={phases}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="phase" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="reviews" name="Reviews" fill="#4285f4" />
            <Bar dataKey="comments" name="Comments" fill="#34a853" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </BrowserOnly>
  );
}
