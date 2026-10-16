import React from 'react';
import { InboxIcon } from 'lucide-react';

export default function EmptyState({ message = 'No data available' }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 flex flex-col items-center justify-center text-center">
      <InboxIcon className="w-12 h-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Data</h3>
      <p className="text-gray-600 dark:text-gray-400">{message}</p>
    </div>
  );
}
