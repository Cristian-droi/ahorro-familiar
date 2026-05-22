'use client';

import React, { useState, useMemo } from 'react';
import { cop } from '@/lib/format';

// =============================================================================
// Auxiliares de formato
// =============================================================================
function formatK(val: number): string {
  if (val >= 1_000_000) {
    return `$${(val / 1_000_000).toFixed(1)}M`;
  }
  if (val >= 1_000) {
    return `$${(val / 1_000).toFixed(0)}k`;
  }
  return `$${val}`;
}

// =============================================================================
// 1. InflowOutflowChart (Comparativo de Barras: Ingresos vs Egresos)
// =============================================================================
type InflowOutflowData = {
  month: string; // ej. "Ene", "Feb"
  inflow: number;
  outflow: number;
};

type InflowOutflowChartProps = {
  data: InflowOutflowData[];
};

export function InflowOutflowChart({ data }: InflowOutflowChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { maxVal, points } = useMemo(() => {
    if (data.length === 0) return { maxVal: 100_000, points: [] };
    const max = Math.max(...data.flatMap((d) => [d.inflow, d.outflow]));
    // Evitar división por cero
    const maxVal = max === 0 ? 100_000 : max * 1.15; // 15% de margen superior
    return { maxVal, points: data };
  }, [data]);

  // Dimensiones del SVG
  const width = 500;
  const height = 220;
  const paddingLeft = 55;
  const paddingRight = 15;
  const paddingTop = 25;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none overflow-visible"
      >
        {/* Grilla horizontal */}
        {yTicks.map((tick, i) => {
          const y = height - paddingBottom - tick * chartHeight;
          const val = tick * maxVal;
          return (
            <g key={i} className="opacity-40">
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="text-[10px] font-medium fill-[var(--color-text-subtle)] font-sans"
              >
                {formatK(val)}
              </text>
            </g>
          );
        })}

        {/* Barras y etiquetas del Eje X */}
        {points.map((d, idx) => {
          const sectionWidth = chartWidth / points.length;
          const groupCenterX = paddingLeft + idx * sectionWidth + sectionWidth / 2;

          const barWidth = Math.min(14, sectionWidth * 0.3);
          const gap = 3;

          // Alturas
          const inflowHeight = (d.inflow / maxVal) * chartHeight;
          const outflowHeight = (d.outflow / maxVal) * chartHeight;

          // Coordenadas X
          const inflowX = groupCenterX - barWidth - gap / 2;
          const outflowX = groupCenterX + gap / 2;

          // Coordenadas Y
          const inflowY = height - paddingBottom - inflowHeight;
          const outflowY = height - paddingBottom - outflowHeight;

          const isHovered = hoveredIdx === idx;

          return (
            <g key={idx}>
              {/* Fondo invisible para mejor interacción hover */}
              <rect
                x={paddingLeft + idx * sectionWidth}
                y={paddingTop}
                width={sectionWidth}
                height={chartHeight}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              />

              {/* Barra de Ingreso (Verde) */}
              <rect
                x={inflowX}
                y={inflowY}
                width={barWidth}
                height={Math.max(2, inflowHeight)}
                rx={3}
                fill={isHovered ? 'var(--color-success)' : 'var(--color-success-soft)'}
                stroke={isHovered ? 'var(--color-success)' : 'transparent'}
                strokeWidth={1}
                className="transition-all duration-200"
              />

              {/* Barra de Egreso (Rojo) */}
              <rect
                x={outflowX}
                y={outflowY}
                width={barWidth}
                height={Math.max(2, outflowHeight)}
                rx={3}
                fill={isHovered ? 'var(--color-danger)' : 'var(--color-danger-soft)'}
                stroke={isHovered ? 'var(--color-danger)' : 'transparent'}
                strokeWidth={1}
                className="transition-all duration-200"
              />

              {/* Indicador de Hover General */}
              {isHovered && (
                <rect
                  x={paddingLeft + idx * sectionWidth + 4}
                  y={paddingTop - 5}
                  width={sectionWidth - 8}
                  height={chartHeight + 10}
                  fill="var(--color-brand)"
                  opacity={0.05}
                  rx={6}
                  pointerEvents="none"
                />
              )}

              {/* Etiqueta del Mes */}
              <text
                x={groupCenterX}
                y={height - 10}
                textAnchor="middle"
                className={`text-[10px] font-semibold font-sans transition-colors ${
                  isHovered
                    ? 'fill-[var(--color-text)] font-bold'
                    : 'fill-[var(--color-text-subtle)]'
                }`}
              >
                {d.month}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip HTML Flotante */}
      {hoveredIdx !== null && points[hoveredIdx] && (
        <div
          className="absolute z-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[8px] p-2.5 shadow-lg pointer-events-none text-left flex flex-col gap-1 transition-all animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: `${
              paddingLeft +
              hoveredIdx * (chartWidth / points.length) +
              chartWidth / points.length / 2 +
              15
            }px`,
            top: '15px',
            transform: hoveredIdx > points.length / 2 ? 'translateX(-115%)' : 'none',
          }}
        >
          <div className="text-[11px] font-bold text-[var(--color-text-subtle)] uppercase tracking-wider">
            {points[hoveredIdx].month}
          </div>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-success)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
            Ingresos: {cop(points[hoveredIdx].inflow)}
          </div>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-danger)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-danger)]" />
            Egresos: {cop(points[hoveredIdx].outflow)}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 2. SavingsGrowthChart (Gráfico de Línea + Área para Ahorros)
// =============================================================================
type SavingsData = {
  month: string;
  cumulativeSavings: number;
};

type SavingsGrowthChartProps = {
  data: SavingsData[];
};

export function SavingsGrowthChart({ data }: SavingsGrowthChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { maxVal, points } = useMemo(() => {
    if (data.length === 0) return { maxVal: 100_000, points: [] };
    const max = Math.max(...data.map((d) => d.cumulativeSavings));
    const maxVal = max === 0 ? 100_000 : max * 1.15;
    return { maxVal, points: data };
  }, [data]);

  // Dimensiones del SVG
  const width = 500;
  const height = 220;
  const paddingLeft = 55;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Ticks grilla
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  // Generar path de la línea (con curvas bezier simples)
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points
      .map((d, idx) => {
        const x = paddingLeft + (idx / (points.length - 1)) * chartWidth;
        const y = height - paddingBottom - (d.cumulativeSavings / maxVal) * chartHeight;
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [points, maxVal, chartWidth, chartHeight]);

  // Generar path del área sombreada
  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    const startX = paddingLeft;
    const endX = paddingLeft + chartWidth;
    const baseY = height - paddingBottom;
    return `${linePath} L ${endX} ${baseY} L ${startX} ${baseY} Z`;
  }, [linePath, chartWidth]);

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none overflow-visible"
      >
        <defs>
          {/* Degradado para el área de la curva */}
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0.00" />
          </linearGradient>
        </defs>

        {/* Grilla horizontal */}
        {yTicks.map((tick, i) => {
          const y = height - paddingBottom - tick * chartHeight;
          const val = tick * maxVal;
          return (
            <g key={i} className="opacity-40">
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="var(--color-border)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="text-[10px] font-medium fill-[var(--color-text-subtle)] font-sans"
              >
                {formatK(val)}
              </text>
            </g>
          );
        })}

        {/* Área rellenada */}
        {areaPath && (
          <path d={areaPath} fill="url(#chartGradient)" pointerEvents="none" />
        )}

        {/* Línea principal */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}

        {/* Ticks e interactividad por mes */}
        {points.map((d, idx) => {
          const x = paddingLeft + (idx / (points.length - 1)) * chartWidth;
          const y = height - paddingBottom - (d.cumulativeSavings / maxVal) * chartHeight;
          const sectionWidth = chartWidth / (points.length - 1);
          const isHovered = hoveredIdx === idx;

          return (
            <g key={idx}>
              {/* Línea indicadora vertical en hover */}
              {isHovered && (
                <line
                  x1={x}
                  y1={paddingTop}
                  x2={x}
                  y2={height - paddingBottom}
                  stroke="var(--color-brand)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  pointerEvents="none"
                />
              )}

              {/* Punto indicador */}
              <circle
                cx={x}
                cy={y}
                r={isHovered ? 5.5 : 4}
                fill={isHovered ? 'var(--color-brand)' : 'var(--color-surface)'}
                stroke="var(--color-brand)"
                strokeWidth={2}
                className="transition-all duration-150"
                pointerEvents="none"
              />

              {/* Detector de eventos hover (rectángulo invisible centrado en el punto) */}
              <rect
                x={idx === 0 ? x : x - sectionWidth / 2}
                y={paddingTop}
                width={
                  idx === 0 || idx === points.length - 1
                    ? sectionWidth / 2
                    : sectionWidth
                }
                height={chartHeight}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              />

              {/* Etiqueta Eje X */}
              {/* Mostramos etiquetas salteadas si hay muchos datos para que no se superpongan */}
              {(points.length < 8 || idx % 2 === 0 || idx === points.length - 1) && (
                <text
                  x={x}
                  y={height - 10}
                  textAnchor="middle"
                  className={`text-[10px] font-semibold font-sans transition-colors ${
                    isHovered
                      ? 'fill-[var(--color-text)] font-bold'
                      : 'fill-[var(--color-text-subtle)]'
                  }`}
                >
                  {d.month}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip HTML */}
      {hoveredIdx !== null && points[hoveredIdx] && (
        <div
          className="absolute z-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[8px] p-2.5 shadow-lg pointer-events-none text-left flex flex-col gap-1 transition-all animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: `${
              paddingLeft +
              (hoveredIdx / (points.length - 1)) * chartWidth +
              15
            }px`,
            top: '15px',
            transform: hoveredIdx > points.length / 2 ? 'translateX(-115%)' : 'none',
          }}
        >
          <div className="text-[11px] font-bold text-[var(--color-text-subtle)] uppercase tracking-wider">
            {points[hoveredIdx].month}
          </div>
          <div className="flex items-center gap-2 text-[13px] font-bold text-[var(--color-text)]">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-brand)]" />
            Capital: {cop(points[hoveredIdx].cumulativeSavings)}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 3. PortfolioDonutChart (Gráfico de Dona de distribución del portafolio)
// =============================================================================
type DonutItem = {
  name: string;
  value: number;
  color: string;
};

type PortfolioDonutChartProps = {
  items: DonutItem[];
  totalLabel: string;
  totalValue: number | string;
};

export function PortfolioDonutChart({
  items,
  totalLabel,
  totalValue,
}: PortfolioDonutChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = useMemo(() => items.reduce((s, i) => s + i.value, 0), [items]);

  // Variables para dibujar los arcos SVG
  const radius = 55;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius;
  const size = 150;
  const center = size / 2;

  let currentOffset = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-6 py-4">
      {/* Dona SVG */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={strokeWidth}
            className="opacity-20"
          />

          {total > 0 &&
            items.map((item, idx) => {
              const share = item.value / total;
              const strokeLength = share * circumference;
              const strokeOffset = circumference - currentOffset;
              currentOffset += strokeLength;

              const isHovered = hoveredIdx === idx;

              return (
                <circle
                  key={idx}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={isHovered ? strokeWidth + 3 : strokeWidth}
                  strokeDasharray={`${strokeLength} ${circumference}`}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="round"
                  className="transition-all duration-200 cursor-pointer origin-center"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              );
            })}
        </svg>

        {/* Centro del Donut */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
          <span className="text-[10px] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider">
            {totalLabel}
          </span>
          <span className="text-[14px] font-extrabold tracking-tight mt-0.5 text-[var(--color-text)]">
            {totalValue}
          </span>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-col gap-2.5">
        {items.map((item, idx) => {
          const isHovered = hoveredIdx === idx;
          const percentage = total > 0 ? ((item.value / total) * 100).toFixed(0) : '0';

          return (
            <div
              key={idx}
              className={`flex items-center gap-3 transition-opacity ${
                hoveredIdx !== null && !isHovered ? 'opacity-40' : 'opacity-100'
              }`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <span
                className="w-3 h-3 rounded-[4px] shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <div className="flex flex-col text-left">
                <span className="text-[12px] font-semibold text-[var(--color-text)]">
                  {item.name}
                </span>
                <span className="text-[10px] text-[var(--color-text-subtle)] font-medium">
                  {item.value} unidades ({percentage}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
