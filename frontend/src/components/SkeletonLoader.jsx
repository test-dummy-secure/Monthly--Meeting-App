// src/components/SkeletonLoader.jsx
import React from "react";

/**
 * Generic skeleton loader that can be used while data is being fetched.
 * Accepts optional `rows` to render multiple placeholder lines.
 */
export default function SkeletonLoader({ rows = 5 }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"
        />
      ))}
    </div>
  );
}
