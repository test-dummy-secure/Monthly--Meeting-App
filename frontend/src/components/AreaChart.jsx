import React from 'react';

export const AreaChart = ({ data }) => {
  if (!data || data.length === 0) return null;

  const width = 500;
  const height = 200;
  const padding = 30;

  // Find max value to scale chart
  const allValues = data.flatMap(d => [d.identified, d.resolved]);
  const maxValue = Math.max(...allValues, 10) * 1.1; // 10% buffer

  const pointsCount = data.length;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Calculate coordinates for points
  const getCoordinates = (key) => {
    return data.map((d, index) => {
      const x = padding + (index / (pointsCount - 1)) * chartWidth;
      const y = padding + chartHeight - (d[key] / maxValue) * chartHeight;
      return { x, y };
    });
  };

  const identifiedCoords = getCoordinates('identified');
  const resolvedCoords = getCoordinates('resolved');

  // Convert coordinate points to Bezier Curve path
  const getBezierPath = (coords) => {
    if (coords.length === 0) return '';
    let d = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpX1 = curr.x + (next.x - curr.x) / 3;
      const cpY1 = curr.y;
      const cpX2 = curr.x + (2 * (next.x - curr.x)) / 3;
      const cpY2 = next.y;
      d += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${next.x} ${next.y}`;
    }
    return d;
  };

  const idPath = getBezierPath(identifiedCoords);
  const resPath = getBezierPath(resolvedCoords);

  // Paths for closed shapes to fill gradient
  const idClosedPath = identifiedCoords.length > 0 
    ? `${idPath} L ${identifiedCoords[identifiedCoords.length - 1].x} ${height - padding} L ${identifiedCoords[0].x} ${height - padding} Z` 
    : '';
  const resClosedPath = resolvedCoords.length > 0 
    ? `${resPath} L ${resolvedCoords[resolvedCoords.length - 1].x} ${height - padding} L ${resolvedCoords[0].x} ${height - padding} Z` 
    : '';

  return (
    <div className="glass-panel p-6 flex flex-col gap-4 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Remediation Velocity Trends</h3>
          <p className="text-xs text-slate-400">Comparing identified security vulnerabilities against verified fixes</p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500"></span>
            <span className="text-slate-300">Identified</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
            <span className="text-slate-300">Resolved</span>
          </div>
        </div>
      </div>

      <div className="relative w-full h-[220px]">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          <defs>
            {/* Gradients */}
            <linearGradient id="idGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="resGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
            const y = padding + ratio * chartHeight;
            const val = Math.round(maxValue * (1 - ratio));
            return (
              <g key={index} className="opacity-40">
                <line 
                  x1={padding} 
                  y1={y} 
                  x2={width - padding} 
                  y2={y} 
                  stroke="#334155" 
                  strokeWidth="0.5" 
                  strokeDasharray="4 4" 
                />
                <text 
                  x={padding - 5} 
                  y={y + 3} 
                  fill="#94a3b8" 
                  fontSize="8" 
                  textAnchor="end" 
                  className="font-mono"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* X Axis Labels */}
          {data.map((d, index) => {
            const x = padding + (index / (pointsCount - 1)) * chartWidth;
            return (
              <text
                key={index}
                x={x}
                y={height - padding + 15}
                fill="#94a3b8"
                fontSize="8"
                textAnchor="middle"
                className="font-semibold"
              >
                {d.month}
              </text>
            );
          })}

          {/* Area Fills */}
          <path d={idClosedPath} fill="url(#idGrad)" />
          <path d={resClosedPath} fill="url(#resGrad)" />

          {/* Lines */}
          <path d={idPath} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
          <path d={resPath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" />

          {/* Data Points Dots */}
          {identifiedCoords.map((pt, i) => (
            <circle key={`id-${i}`} cx={pt.x} cy={pt.y} r="3" fill="#0b0f19" stroke="#ef4444" strokeWidth="1.5" className="hover:r-5 transition-all cursor-pointer" />
          ))}
          {resolvedCoords.map((pt, i) => (
            <circle key={`res-${i}`} cx={pt.x} cy={pt.y} r="3" fill="#0b0f19" stroke="#4f46e5" strokeWidth="1.5" className="hover:r-5 transition-all cursor-pointer" />
          ))}
        </svg>
      </div>
    </div>
  );
};
