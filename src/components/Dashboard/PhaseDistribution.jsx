import BrowserOnly from '@docusaurus/BrowserOnly';
import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function PhaseDistribution({ phases }) {
  if (!phases?.length) {
    return <p>フェーズ別のデータがまだありません。</p>;
  }

  // Real run artifacts carry reviews/comments per phase; the offline registry
  // inventory carries a skills count per phase. Render whichever is present.
  const isInventory = phases[0]?.skills != null;

  return (
    <BrowserOnly fallback={<p>Chart is loading...</p>}>
      {() => (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={phases}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="phase" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            {isInventory ? (
              <Bar dataKey="skills" name="Skills" fill="#4285f4" />
            ) : (
              <>
                <Bar dataKey="reviews" name="Reviews" fill="#4285f4" />
                <Bar dataKey="comments" name="Comments" fill="#34a853" />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </BrowserOnly>
  );
}
