'use client';

/**
 * RevokeAgentModal Component.
 * Confirmation dialog for revoking an agent device:
 * - Requires reason input for audit compliance
 * - Warns that revoked devices are permanently denied heartbeat and claim access
 */

import React, { useState } from 'react';
import type { AgentDeviceStatus } from '../types';

export interface RevokeAgentModalProps {
  isOpen: boolean;
  device: AgentDeviceStatus | null;
  isRevoking: boolean;
  onClose: () => void;
  onConfirm: (deviceId: string, reason: string) => Promise<void> | void;
}

export function RevokeAgentModal({
  isOpen,
  device,
  isRevoking,
  onClose,
  onConfirm
}: RevokeAgentModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !device) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide a reason for revoking this device.');
      return;
    }
    setError(null);
    await onConfirm(device.id, reason);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revoke-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <span className="text-xl text-rose-600" aria-hidden="true">
              ⚠️
            </span>
            <h3 id="revoke-modal-title" className="text-base font-bold text-slate-900">
              Revoke Agent Device
            </h3>
          </div>
          <button
            type="button"
            disabled={isRevoking}
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
            aria-label="Close revoke dialog"
          >
            ✕
          </button>
        </div>

        {/* Warning Body */}
        <div className="space-y-3 text-xs text-slate-600">
          <p>
            Are you sure you want to revoke <strong>{device.deviceName}</strong>?
          </p>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-900 space-y-1 font-medium">
            <p className="font-bold">Permanent Security Revocation:</p>
            <p>
              Once revoked, this Windows PC will be immediately disconnected. Any print job leases currently held will be aborted, and this device will never be permitted to claim jobs or send heartbeats.
            </p>
          </div>
        </div>

        {/* Reason Input */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label htmlFor="revoke-reason" className="block font-bold text-slate-700 mb-1">
              Reason for Revocation (Required for Audit Log):
            </label>
            <textarea
              id="revoke-reason"
              rows={2}
              value={reason}
              onChange={e => {
                setReason(e.target.value);
                if (e.target.value.trim()) setError(null);
              }}
              placeholder="e.g. PC retired from shop; replaced counter hardware; compromised workstation"
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs font-semibold text-rose-800"
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={isRevoking}
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isRevoking}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-rose-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              {isRevoking && (
                <svg
                  className="h-3.5 w-3.5 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              <span>{isRevoking ? 'Revoking...' : 'Confirm Revoke'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
