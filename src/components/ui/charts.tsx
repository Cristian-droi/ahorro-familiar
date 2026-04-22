import React from 'react';

/**
 * Gráficos SVG ligeros para el dashboard. No dependen de librerías externas —
 * reimplementados del diseño original (shared.jsx).
 */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  className?: string;
}

export function Sparkline({
  data,
  width = 280,
  height = 72,
  color = 'var(--color-brand)',
  fill,
  strokeWidth = 2,
  className,
}: SparklineProps) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map<[number, number]>((v, i) => [
    i * step,
    height - ((v - min) / range) * (height - 6) - 3,
  ]);
  const d = pts
    .map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
    .join(' ');
  const area = d + ` L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {fill && <path d={area} fill={fill} opacity={0.4} />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface BarsProps {
  data: { label: string; value: number }[];
  width?: number;
  height?: number;
  color?: string;
  track?: string;
  className?: string;
}

export function Bars({
  data,
  width = 480,
  height = 160,
  color = 'var(--color-brand)',
  track = 'var(--color-surface-alt)',
  className,
}: BarsProps) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value));
  const n = data.length;
  const gap = 14;
  const bw = (width - gap * (n - 1)) / n;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMax meet"
      className={className}
      style={{ display: 'block' }}
    >
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 28);
        const x = i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={0} width={bw} height={height - 28} fill={track} rx={4} />
            <rect
              x={x}
              y={height - 28 - h}
              width={bw}
              height={h}
              fill={color}
              rx={4}
            />
            <text
              x={x + bw / 2}
              y={height - 10}
              fontSize="11"
              textAnchor="middle"
              fill="currentColor"
              opacity="0.55"
              style={{ fontFamily: 'inherit' }}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface DonutProps {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}

export function Donut({
  value,
  size = 140,
  stroke = 14,
  color = 'var(--color-brand)',
  track = 'var(--color-surface-alt)',
  children,
}: DonutProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={track}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
