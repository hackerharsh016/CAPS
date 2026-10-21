'use client';

/**
 * AgentDeviceList Component.
 * Displays paired Windows print agents connected to the shop:
 * - Device name and fingerprint
 * - Online / Offline status badge (based on 90s heartbeat)
 * - Agent software version
 * - Revoke device action trigger
 */

import React from 'react';
import type { AgentDeviceStatus } from '../types';

export interface AgentDeviceListProps {
  devices: AgentDeviceStatus[];
  isLoading: boolean;
  onPairNew: () => void;
  onRevoke: (device: AgentDeviceStatus) => void;
  disabled?: boolean | undefined;
}

export function AgentDeviceList({
  devices,
  isLoading,
  onPairNew,
  onRevoke,
  disabled = false
}: AgentDeviceListProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">Paired Windows Print Agents</h3>
          <p className="mt-1 text-xs text-slate-500">
            Physical Windows PCs running the CAPS Desktop Agent authorized to claim and print jobs.
          </p>
        </div>

        <button
          type="button"
          disabled={disabled || isLoading}
          onClick={onPairNew}
          className="inline-flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 self-start sm:self-auto"
        >
          <span>➕ Pair New Windows PC</span>
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-6 space-y-3" role="status" aria-label="Loading devices">
          {[1, 2].map(i => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-50 border border-slate-100" />
          ))}
        </div>
      ) : devices.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500">
          <span className="text-3xl block mb-2">💻</span>
          <p className="font-semibold text-slate-700">No Windows print agents paired yet.</p>
          <p className="mt-0.5 text-slate-400">
            Click <strong>Pair New Windows PC</strong> to generate a temporary code and connect your counter computer.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {devices.map(device => {
            const lastSeenDate = new Date(device.lastHeartbeatAt);
            const timeAgoStr = lastSeenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <div key={device.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-base" aria-hidden="true">
                      💻
                    </span>
                    <span className="text-xs font-bold text-slate-900">{device.deviceName}</span>

                    {/* Online / Offline Status Badge */}
                    <span
                      className={`inline-flex items-center space-x-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        device.isRevoked
                          ? 'bg-rose-100 text-rose-800'
                          : device.isOnline
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          device.isRevoked
                            ? 'bg-rose-500'
                            : device.isOnline
                              ? 'bg-emerald-500 animate-pulse'
                              : 'bg-slate-400'
                        }`}
                      />
                      <span>
                        {device.isRevoked ? 'Revoked' : device.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </span>

                    <span className="text-[11px] font-mono text-slate-400">
                      v{device.agentVersion}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pl-6">
                    {device.deviceFingerprint && (
                      <span className="font-mono">Fingerprint: {device.deviceFingerprint.slice(0, 12)}...</span>
                    )}
                    <span>•</span>
                    <span>
                      {device.isRevoked
                        ? `Revoked: ${device.revokedReason || 'Manual action'}`
                        : `Last heartbeat: ${timeAgoStr}`}
                    </span>
                  </div>
                </div>

                {/* Revoke Action */}
                {!device.isRevoked && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRevoke(device)}
                    className="self-end sm:self-auto rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 shadow-sm hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
                  >
                    Revoke Device
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
