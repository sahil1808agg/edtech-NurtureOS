'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import type { TimeseriesBucket } from './ObservabilityDashboard';

// Validated default categorical palette (dataviz skill, references/palette.md):
// slot 1 (blue) / slot 2 (orange), light + dark steps. Chrome/grid/ink tokens
// from the same reference. Resolved in JS rather than CSS var() because
// Recharts sets these as SVG presentation attributes, which don't resolve
// custom properties the way an inline `style` would.
const LIGHT = {
  textSecondary: '#52514e', muted: '#898781', grid: '#e1e0d9', baseline: '#c3c2b7',
  series1: '#2a78d6', series2: '#eb6834',
};
const DARK = {
  textSecondary: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', baseline: '#383835',
  series1: '#3987e5', series2: '#d95926',
};

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(mql.matches);
    const listener = (e: MediaQueryListEvent) => setDark(e.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, []);
  return dark;
}

function formatBucket(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
}

export function UsageCharts({ timeseries }: { timeseries: TimeseriesBucket[] }) {
  const dark = usePrefersDark();
  const c = dark ? DARK : LIGHT;
  const tooltipStyle = {
    background: dark ? '#1a1a19' : '#fcfcfb',
    border: `1px solid ${c.grid}`,
    borderRadius: 6,
    fontSize: 12,
    color: c.textSecondary,
  };

  if (timeseries.length === 0) {
    return <p className="mt-6 text-sm text-[var(--muted)]">No calls in this range to chart.</p>;
  }

  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-2">
      <ChartCard title="Requests over time">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={timeseries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="bucket" tickFormatter={formatBucket} stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} />
            <YAxis stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={formatBucket} />
            <Bar dataKey="requests" name="Requests" fill={c.series1} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Cost over time">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={timeseries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="bucket" tickFormatter={formatBucket} stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} />
            <YAxis stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} tickFormatter={v => `$${v.toFixed(2)}`} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={formatBucket} formatter={(v: number) => [`$${v.toFixed(4)}`, 'Cost']} />
            <Line type="monotone" dataKey="costUsd" name="Cost" stroke={c.series1} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Latency (p50 vs p95)">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={timeseries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="bucket" tickFormatter={formatBucket} stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} />
            <YAxis stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} tickFormatter={v => `${v}ms`} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={formatBucket} />
            <Legend wrapperStyle={{ fontSize: 11, color: c.textSecondary }} />
            <Line type="monotone" dataKey="p50LatencyMs" name="p50" stroke={c.series1} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="p95LatencyMs" name="p95" stroke={c.series2} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Tokens (input vs output)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={timeseries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="bucket" tickFormatter={formatBucket} stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} />
            <YAxis stroke={c.baseline} tick={{ fill: c.muted, fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={formatBucket} />
            <Legend wrapperStyle={{ fontSize: 11, color: c.textSecondary }} />
            <Bar dataKey="inputTokens" name="Input" stackId="tokens" fill={c.series1} radius={[0, 0, 0, 0]} />
            <Bar dataKey="outputTokens" name="Output" stackId="tokens" fill={c.series2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <h3 className="text-xs font-medium text-[var(--muted)]">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
