import React from 'react';
import { CheckCircle2, Clock, ShieldAlert, Cpu, Sparkles, Send, AlertTriangle } from 'lucide-react';

export default function ActivityTimeline({ activities = [] }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 text-center text-gray-500">
        No recent activities
      </div>
    );
  }

  const activityIcons = {
    Meeting: Clock,
    Finding: ShieldAlert,
    Escalation: AlertTriangle,
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
      <h3 className="text-lg font-semibold mb-6 text-gray-900 dark:text-white">Recent Activities</h3>
      
      <div className="space-y-4">
        {activities.map((activity, index) => {
          const IconComponent = activityIcons[activity.type] || Clock;
          return (
            <div key={activity.id || index} className="flex items-start space-x-4 pb-4 border-b dark:border-gray-700 last:border-b-0">
              <div className="flex-shrink-0">
                <IconComponent className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{activity.type}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{activity.description}</p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  {new Date(activity.time).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
