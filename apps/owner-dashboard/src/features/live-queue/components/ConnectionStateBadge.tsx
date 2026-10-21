'use client';

/**
 * Realtime Connection Status Badge Component for CAPS Owner Dashboard.
 * Accessible live region signaling WebSocket connection health.
 */

import React from 'react';
import type { RealtimeConnectionState } from '../types';

export interface ConnectionStateBadgeProps {
  state: RealtimeConnectionState;
}

export function ConnectionStateBadge({ state }: ConnectionStateBadgeProps) {
  const configs: Record<
    RealtimeConnectionState,
    { label: string; dotClass: string; badgeClass: string }
  > = {
    connected: {
      label: 'Live Realtime',
      dotClass: 'bg-emerald-500 animate-pulse',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    },
    connecting: {
      label: 'Connecting...',
      dotClass: 'bg-amber-500 animate-ping',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    reconnecting: {
      label: 'Reconnecting...',
      dotClass: 'bg-amber-500 animate-ping',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    fallback_polling: {
      label: 'Auto-refresh Active',
      dotClass: 'bg-blue-500',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200'
    },
    disconnected: {
      label: 'Disconnected',
      dotClass: 'bg-slate-400',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200'
    }
  };

  const current = configs[state] || configs.disconnected;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center space-x-2 rounded-full border px-2.5 py-1 text-xs font-medium ${current.badgeClass}`}
    >
      <span className={`h-2 w-2 rounded-full ${current.dotClass}`} aria-hidden="true" />
      <span>{current.label}</span>
    </div>
  );
}
