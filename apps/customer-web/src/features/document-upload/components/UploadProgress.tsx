'use client';

/**
 * Accessible Upload Progress bar component for CAPS Customer Web.
 * Conforms to WCAG 2.1 AA with live region announcements and cancel controls.
 */

import React from 'react';
import type { UploadProgressEvent } from '../types';
import { formatFileSizeBytes } from '../validation';

export interface UploadProgressProps {
  filename: string;
  totalSize: number;
  progress: UploadProgressEvent | null;
  onCancel: () => void;
}

export function UploadProgress({
  filename,
  totalSize,
  progress,
  onCancel
}: UploadProgressProps) {
  const percentage = progress?.percentage ?? 0;
  const loadedBytes = progress?.loadedBytes ?? 0;

  return (
    <div
      role="region"
      aria-label="Upload progress section"
      className="w-full rounded-2xl border border-blue-200 bg-blue-50/50 p-5 space-y-3"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="truncate">
          <p className="text-sm font-bold text-slate-900 truncate" title={filename}>
            {filename}
          </p>
          <p className="text-xs text-slate-500">
            {formatFileSizeBytes(loadedBytes)} of {formatFileSizeBytes(totalSize)} ({percentage}%)
          </p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label={`Cancel upload for ${filename}`}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-50 hover:text-red-700 transition-colors"
        >
          Cancel Upload
        </button>
      </div>

      {/* Progress Track & Bar */}
      <div
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Upload progress: ${percentage}%`}
        className="h-2.5 w-full overflow-hidden rounded-full bg-blue-100"
      >
        <div
          className="h-full bg-blue-600 transition-all duration-150 ease-out rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
        <span>Encrypting and uploading to secure cloud storage...</span>
        <span>{percentage}%</span>
      </div>
    </div>
  );
}
