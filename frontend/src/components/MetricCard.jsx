import React from 'react';

export const MetricCard = ({ title, value, subtext, icon: Icon, trend, colorClass = "text-indigo-400 border-indigo-500/20" }) => {
  return (
    <div className={`glass-panel glass-panel-hover p-6 flex items-start justify-between relative overflow-hidden group`}>
      {/* Background radial highlight */}
      <div className="absolute -right-8 -bottom-8 w-24 h-24 bg-gradient-to-tr from-indigo-500/5 to-sky-500/5 rounded-full blur-xl group-hover:scale-150 transition-transform duration-500"></div>

      <div className="space-y-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold font-sans text-white tracking-tight">{value}</span>
          {trend && (
            <span className={`text-xs font-bold ${trend.type === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {trend.type === 'up' ? '+' : '-'}{trend.value}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 font-medium">{subtext}</p>
      </div>

      <div className={`p-3 bg-slate-800/80 rounded-xl border border-slate-700/60 shadow-inner group-hover:scale-105 transition-transform duration-300`}>
        {Icon && <Icon className="w-5 h-5 text-indigo-400" />}
      </div>
    </div>
  );
};
