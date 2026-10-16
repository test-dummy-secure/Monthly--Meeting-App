import React from 'react';
import { FaChartBar } from 'react-icons/fa';

/**
 * Reusable KPI Card component.
 * Props:
 * - title: string – label of the KPI
 * - value: string | number – displayed value
 * - icon?: React element – optional icon component
 * - loading?: boolean – show skeleton when true
 * - onClick?: function – callback when card is clicked
 */
export default function KPICard({ title, value, icon, loading, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 flex items-center space-x-4 transition-all transform hover:scale-105 hover:shadow-md active:scale-95 disabled:hover:scale-100 disabled:cursor-default"
    >
      {loading ? (
        <div className="animate-pulse">
          <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>
      ) : (
        icon || <FaChartBar className="text-3xl text-indigo-600" />
      )}
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{title}</p>
        {loading ? (
          <div className="h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        ) : (
          <p className="text-xl font-semibold text-gray-900 dark:text-white">{value}</p>
        )}
      </div>
    </button>
  );
}
