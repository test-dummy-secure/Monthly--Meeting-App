import React from 'react';
import { AlertCircle } from 'lucide-react';

export default function ErrorState({ error = 'An error occurred' }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 flex flex-col items-center justify-center text-center">
      <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Error Loading Data</h3>
      <p className="text-gray-600 dark:text-gray-400">{error}</p>
    </div>
  );
}
