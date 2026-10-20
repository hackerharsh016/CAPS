'use client';

import React from 'react';
import type { JobTrackingInfo } from '../types';

interface QueueMetricsCardProps {
  tracking: JobTrackingInfo;
}

export const QueueMetricsCard: React.FC<QueueMetricsCardProps> = ({ tracking }) => {
  const formatPickupTime = (isoTime: string | null) => {
    if (!isoTime) return null;
    try {
      const date = new Date(isoTime);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  };

  const formattedEta = formatPickupTime(tracking.estimated_pickup_at);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* 1. Queue Tier */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Queue Tier
        </span>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">
            {tracking.priority_tier === 'urgent' ? 'Express Priority' : 'Standard Economy'}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {tracking.priority_tier === 'urgent'
            ? '⚡ Dispatches to printer ahead of standard jobs'
            : 'Processed in order of submission'}
        </p>
      </div>

      {/* 2. Queue Position */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Queue Position
        </span>
        <div className="mt-2 flex items-baseline gap-2">
          {tracking.status === 'printing' ? (
            <span className="text-2xl font-bold text-purple-700">Printing Now</span>
          ) : tracking.status === 'ready' ? (
            <span className="text-2xl font-bold text-emerald-700">At Counter</span>
          ) : tracking.queue_position !== null ? (
            <>
              <span className="text-3xl font-extrabold text-slate-900">
                #{tracking.queue_position}
              </span>
              <span className="text-sm font-medium text-slate-500">
                {tracking.queue_position === 1 ? '(Next in Line)' : 'in queue'}
              </span>
            </>
          ) : (
            <span className="text-2xl font-bold text-slate-400">--</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {tracking.status === 'printing'
            ? 'Pages are actively being spooled'
            : tracking.status === 'ready'
            ? 'Waiting for customer collection'
            : tracking.queue_position === 1
            ? 'Next job to be claimed by print agent'
            : 'Updates dynamically as previous jobs complete'}
        </p>
      </div>

      {/* 3. Estimated Wait / Pickup */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Estimated Pickup
        </span>
        <div className="mt-2 flex items-baseline gap-2">
          {tracking.is_agent_offline ? (
            <span className="text-xl font-bold text-amber-700">Delayed (Offline)</span>
          ) : tracking.status === 'ready' ? (
            <span className="text-2xl font-bold text-emerald-700">Ready Now</span>
          ) : tracking.status === 'unknown' ? (
            <span className="text-xl font-bold text-slate-500">Unknown</span>
          ) : tracking.estimated_minutes_remaining !== null ? (
            <>
              <span className="text-3xl font-extrabold text-blue-600">
                ~{tracking.estimated_minutes_remaining}
              </span>
              <span className="text-sm font-medium text-slate-500">mins</span>
            </>
          ) : (
            <span className="text-2xl font-bold text-slate-400">--</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {tracking.is_agent_offline
            ? 'Workstation offline; queue paused'
            : tracking.status === 'ready'
            ? 'Available immediately at counter'
            : formattedEta
            ? `Estimated by ~${formattedEta}`
            : 'Calculating ETA based on queue density'}
        </p>
      </div>
    </div>
  );
};
