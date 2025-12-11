import BrowserOnly from '@docusaurus/BrowserOnly';
import React from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function CostTrends({ trend }) {
  if (!trend?.length) {
    return <p>コスト推移のデータがまだありません。</p>;
  }

  return (
    <BrowserOnly fallback={<p>Chart is loading...</p>}>
      {() => (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trend}>
            <XAxis dataKey="date" />
            <YAxis yAxisId="left" dataKey="costUsd" tickFormatter={(v) => `$${v}`} />
            <YAxis yAxisId="right" orientation="right" dataKey="tokens" />
            <Tooltip formatter={(value, name) => (name === 'costUsd' ? `$${value}` : value)} />
            <Line
              type="monotone"
              dataKey="costUsd"
              stroke="#fbbc05"
              strokeWidth={2}
              dot={false}
              name="Cost (USD)"
              yAxisId="left"
            />
            <Line
              type="monotone"
              dataKey="tokens"
              stroke="#1a73e8"
              strokeWidth={2}
              dot={false}
              name="Tokens"
              yAxisId="right"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </BrowserOnly>
  );
}
