import React from 'react';
import { AlertCircle } from 'lucide-react';

export default function FindingsTable({ findings = [] }) {
  if (!findings || findings.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 text-center text-gray-500">
        No findings available
      </div>
    );
  }

  const severityColors = {
    Critical: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
    High: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200',
    Medium: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
    Low: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
  };

  const statusColors = {
    Open: 'text-red-600',
    'In Review': 'text-yellow-600',
    Resolved: 'text-green-600',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-semibold mb-6 text-gray-900 dark:text-white">Recent Findings</h3>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b dark:border-gray-700">
            <tr>
              <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Title</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Severity</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Status</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="py-3 px-4 text-gray-900 dark:text-white">{finding.title}</td>
                <td className="py-3 px-4">
                  <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${severityColors[finding.severity] || 'bg-gray-100 text-gray-800'}`}>
                    {finding.severity}
                  </span>
                </td>
                <td className={`py-3 px-4 font-medium ${statusColors[finding.status] || 'text-gray-600'}`}>
                  {finding.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
