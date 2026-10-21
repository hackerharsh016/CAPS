'use client';

/**
 * HardwareIncidentBanner Component.
 * Displays real-time hardware incident notifications:
 * - Paper Jam
 * - Printer Offline / Disconnected
 * - Out of Paper / Media Low
 * - Door Open / Cover Open
 * Includes severity indicators and operator instructions.
 */

import React from 'react';
import type { HardwareIncident } from '../types';

export interface HardwareIncidentBannerProps {
  incidents: HardwareIncident[];
  onDismiss?: ((incidentId: string) => void) | undefined;
}

export function HardwareIncidentBanner({
  incidents,
  onDismiss
}: HardwareIncidentBannerProps) {
  if (!incidents || incidents.length === 0) {
    return null;
  }

  return (
    <aside
      className="space-y-3"
      role="region"
      aria-label="Hardware & Agent Incidents"
    >
      {incidents.map(inc => {
        const isCritical = inc.severity === 'critical' || inc.incidentType === 'jam';

        return (
          <div
            key={inc.id}
            role="alert"
            className={`flex items-start justify-between rounded-xl border p-4 shadow-sm transition-all ${
              isCritical
                ? 'border-rose-300 bg-rose-50/90 text-rose-900'
                : 'border-amber-300 bg-amber-50/90 text-amber-900'
            }`}
          >
            <div className="flex items-start space-x-3">
              <span className="text-xl" aria-hidden="true">
                {inc.incidentType === 'jam'
                  ? '⚠️'
                  : inc.incidentType === 'out_of_paper'
                    ? '📄'
                    : '🔌'}
              </span>
              <div>
                <div className="flex items-center space-x-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider">
                    {inc.incidentType === 'jam'
                      ? 'Hardware Error: Paper Jam'
                      : inc.incidentType === 'out_of_paper'
                        ? 'Hardware Notice: Out of Paper'
                        : 'Hardware Offline: Printer Unreachable'}
                  </h4>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      isCritical
                        ? 'bg-rose-200 text-rose-800'
                        : 'bg-amber-200 text-amber-800'
                    }`}
                  >
                    {inc.printerName}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed font-medium">
                  {inc.message}
                </p>
                <p className="mt-1 text-[11px] opacity-75">
                  Spooling automatically paused to prevent wasted stock and corrupt print batches.
                </p>
              </div>
            </div>

            {onDismiss && (
              <button
                type="button"
                onClick={() => onDismiss(inc.id)}
                className="ml-4 rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
                aria-label="Dismiss incident banner"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </aside>
  );
}
