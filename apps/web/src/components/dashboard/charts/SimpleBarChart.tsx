interface DataPoint {
  label: string;
  value: number;
}

interface SimpleBarChartProps {
  data: DataPoint[];
  height?: number;
  barColor?: string;
  className?: string;
}

export function SimpleBarChart({
  data,
  height = 120,
  barColor = '#3b82f6',
  className = '',
}: SimpleBarChartProps) {
  if (data.length === 0) {
    return (
      <div className={`flex items-center justify-center h-[${height}px] text-zinc-500 text-sm ${className}`}>
        No data
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barWidth = Math.max(100 / data.length - 2, 4);
  const gap = 100 / data.length;

  return (
    <svg
      className={className}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
    >
      {data.map((point, i) => {
        const barHeight = (point.value / maxValue) * (height - 20);
        const x = i * gap + gap / 2 - barWidth / 2;
        const y = height - 20 - barHeight;

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={barColor}
              rx={1}
              className="transition-all duration-200"
            >
              <title>{`${point.label}: ${point.value}`}</title>
            </rect>
            {data.length <= 12 && (
              <text
                x={i * gap + gap / 2}
                y={height - 5}
                textAnchor="middle"
                className="fill-zinc-500 dark:fill-zinc-400"
                style={{ fontSize: '6px' }}
              >
                {point.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
