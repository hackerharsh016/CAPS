'use client';

/**
 * CapabilityChangeAlert Component.
 * Displays warning alerts when driver-reported capabilities (e.g. duplex, color, paper sizes)
 * differ from expected settings or have experienced hardware drops.
 */

import React from 'react';
import type { CapabilityDifference } from '../types';

export interface CapabilityChangeAlertProps {
  difference: CapabilityDifference;
  printerName: string;
}

export function CapabilityChangeAlert({ difference, printerName }: CapabilityChangeAlertProps) {
  if (!difference.hasDifferences || difference.changes.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1"
    >
      <div className="flex items-center space-x-1.5 font-bold">
        <span>⚠️</span>
        <span>Capability Changes Detected on {printerName}</span>
      </div>
      <ul className="list-disc list-inside space-y-0.5 text-amber-800 text-[11px] pl-1 font-medium">
        {difference.changes.map((change, index) => (
          <li key={index}>{change}</li>
        ))}
      </ul>
      <p className="text-[10px] text-amber-700 italic pt-0.5">
        Queue routing will automatically account for these driver changes.
      </p>
    </div>
  );
}
