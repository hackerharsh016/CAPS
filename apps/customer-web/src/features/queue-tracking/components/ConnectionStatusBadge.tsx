'use client';

import React from 'react';
import type { RealtimeConnectionState } from '../realtime-types';

interface ConnectionStatusBadgeProps {
  state: RealtimeConnectionState;
  isStationOffline?: boolean | undefined;
}

export const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = ({
  state,
  isStationOffline = false
}) => {
  if (isStationOffline) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 border border-amber-200 text-amber-800 shadow-sm"
        role="status"
        aria-label="Printer station offline"
      >
        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span>Station Offline</span>
      </div>
    );
  }

  switch (state) {
    case 'connected':
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 shadow-sm"
          role="status"
          aria-label="Realtime connection active"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Live Updates</span>
        </div>
      );
    case 'reconnecting':
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 border border-amber-200 text-amber-800 shadow-sm"
          role="status"
          aria-label="Reconnecting realtime stream"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>Reconnecting...</span>
        </div>
      );
    case 'polling':
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 border border-blue-200 text-blue-800 shadow-sm"
          role="status"
          aria-label="Using fallback polling"
        >
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span>Polling Fallback</span>
        </div>
      );
    case 'connecting':
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-50 border border-slate-200 text-slate-600 shadow-sm"
          role="status"
          aria-label="Connecting"
        >
          <span className="w-2 h-2 rounded-full bg-slate-400 animate-pulse" />
          <span>Connecting...</span>
        </div>
      );
    case 'disconnected':
    default:
      return (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 border border-slate-200 text-slate-500 shadow-sm"
          role="status"
          aria-label="Disconnected"
        >
          <span className="w-2 h-2 rounded-full bg-slate-400" />
          <span>Offline</span>
        </div>
      );
  }
};
