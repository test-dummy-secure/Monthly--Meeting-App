import React from 'react';

// Refined infinity SVG path — matches NxgSecure brand mark exactly.
// viewBox 100×38, strokeWidth 7, rounded caps — both loops symmetric.
const INFINITY_PATH =
  'M50,19 C50,9 43,4 32,4 C21,4 8,9 8,19 C8,29 21,34 32,34 C43,34 50,29 50,19 C50,9 57,4 68,4 C79,4 92,9 92,19 C92,29 79,34 68,34 C57,34 50,29 50,19';

export const InfinityMark = ({ width = 52, height = 20, color = '#1A1814', strokeWidth = 7, className }) => (
  <svg width={width} height={height} viewBox="0 0 100 38" fill="none" aria-hidden="true" className={className}>
    <path
      d={INFINITY_PATH}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Full brand lockup: infinity mark + divider + wordmark
export const NxgLogo = ({ size = 'md' }) => {
  const w          = size === 'sm' ? 38 : 52;
  const h          = size === 'sm' ? 14 : 20;
  const textClass  = size === 'sm' ? 'text-base' : 'text-xl';

  return (
    <div className="inline-flex items-center gap-3">
      <InfinityMark width={w} height={h} />
      <div className="w-px h-5 bg-[#C8C2B8]" />
      <span className={`${textClass} tracking-tight`}>
        <span className="font-bold text-[#1A1814]">Nxg</span>
        <span className="font-normal text-[#9B9589]">Secure</span>
      </span>
    </div>
  );
};
