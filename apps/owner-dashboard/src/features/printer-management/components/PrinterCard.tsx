'use client';

/**
 * PrinterCard Component.
 * Displays discovered physical printer details, assigned device, roles,
 * color & duplex badges, and provides trigger to reassign.
 */

import React from 'react';
import type { Printer } from '../types';

export interface PrinterCardProps {
  printer: Printer;
  onEditAssignment: (printer: Printer) => void;
  disabled?: boolean | undefined;
}

export function PrinterCard({ printer, onEditAssignment, disabled = false }: PrinterCardProps) {
  const isOnline = printer.status === 'online';
  const isBusy = printer.status === 'busy';
  const isError = printer.status === 'error';

  const roleLabels: Record<string, string> = {
    bw: 'B/W Laser',
    color: 'Color Multi-Function',
    large_format: 'Plotter / Large Format'
  };

  return (
    <div
      className={`rounded-xl border p-5 shadow-sm transition-all ${
        printer.is_default
          ? 'border-emerald-300 bg-white ring-1 ring-emerald-500/20'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        {/* Left Section: Details */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl" aria-hidden="true">
                🖨️
              </span>
              <h3 className="text-sm font-bold text-slate-900">{printer.name}</h3>

              {printer.is_default && (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  Default Shop Printer
                </span>
              )}
            </div>

            <p className="mt-1 text-xs text-slate-500">
              Role:{' '}
              <span className="font-semibold text-slate-700">
                {roleLabels[printer.role] || printer.role}
              </span>
            </p>
          </div>

          {/* Assigned Windows Device */}
          <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Assigned Windows Device:</span>
              <span className="font-semibold text-slate-800">
                {printer.device ? printer.device.device_name : 'Unassigned (Local Queue Only)'}
              </span>
            </div>
            {printer.device && (
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Agent v{printer.device.agent_version}</span>
                <span>{printer.device.is_revoked ? '🔴 Revoked' : '🟢 Paired'}</span>
              </div>
            )}
          </div>

          {/* Driver Capabilities Snapshot */}
          <div className="space-y-1 text-xs">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Driver Capabilities
            </span>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                {printer.capabilities.color_modes.includes('color') ? 'Color + B/W' : 'B/W Only'}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                {printer.capabilities.duplex_supported ? 'Duplex Supported' : 'Single-Sided Only'}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700 uppercase">
                {printer.capabilities.paper_sizes.join(', ')}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-700">
                Max Copies: {printer.capabilities.max_copies}
              </span>
            </div>
          </div>
        </div>

        {/* Right Section: Status Badge & Action */}
        <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
          <div>
            <span
              className={`inline-flex items-center space-x-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : isBusy
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : isError
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isOnline
                    ? 'bg-emerald-500'
                    : isBusy
                      ? 'bg-blue-500 animate-pulse'
                      : isError
                        ? 'bg-rose-500'
                        : 'bg-slate-400'
                }`}
              />
              <span className="capitalize">{printer.status}</span>
            </span>
          </div>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onEditAssignment(printer)}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            <span>Configure Assignment</span>
          </button>
        </div>
      </div>
    </div>
  );
}
