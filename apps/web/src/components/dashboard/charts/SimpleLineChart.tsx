interface DataPoint {
  label: string;
  value: number;
}

interface SimpleLineChartProps {
  data: DataPoint[];
  height?: number;
  lineColor?: string;
  fillColor?: string;
  className?: string;
}

export function SimpleLineChart({
  data,
  height = 120,
  lineColor = '#3b82f6',
  fillColor = 'rgba(59, 130, 246, 0.1)',
  className = '',
}: SimpleLineChartProps) {
  if (data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-zinc-500 text-sm ${className}`} style={{ height }}>
        No data
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const padding = { top: 10, right: 5, bottom: 20, left: 5 };
  const chartWidth = 100 - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((point, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
    const y = padding.top + chartHeight - (point.value / maxValue) * chartHeight;
    return { x, y, ...point };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`;

  return (
    <svg
      className={className}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
    >
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1={padding.left}
          y1={padding.top + chartHeight * (1 - ratio)}
          x2={100 - padding.right}
          y2={padding.top + chartHeight * (1 - ratio)}
          stroke="currentColor"
          strokeOpacity={0.1}
          strokeWidth={0.5}
        />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill={fillColor} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points */}
      {points.map((point, i) => (
        <g key={i}>
          <circle cx={point.x} cy={point.y} r={2} fill={lineColor}>
            <title>{`${point.label}: ${point.value}`}</title>
          </circle>
        </g>
      ))}

      {/* X-axis labels */}
      {data.length <= 12 &&
        points.map((point, i) => (
          <text
            key={i}
            x={point.x}
            y={height - 5}
            textAnchor="middle"
            className="fill-zinc-500 dark:fill-zinc-400"
            style={{ fontSize: '6px' }}
          >
            {point.label}
          </text>
        ))}
    </svg>
  );
}
