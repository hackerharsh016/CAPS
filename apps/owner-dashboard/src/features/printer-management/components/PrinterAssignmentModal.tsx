'use client';

/**
 * PrinterAssignmentModal Component.
 * Modal for assigning/reassigning a physical printer to an active shop Windows device,
 * updating its operational role, and marking default status.
 */

import React, { useState } from 'react';
import type { Printer, AgentDevice, PrinterRole } from '../types';

export interface PrinterAssignmentModalProps {
  isOpen: boolean;
  printer: Printer | null;
  devices: AgentDevice[];
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    printer_id: string;
    device_id: string | null;
    role: PrinterRole;
    is_default: boolean;
  }) => Promise<void> | void;
}

export function PrinterAssignmentModal({
  isOpen,
  printer,
  devices,
  isSubmitting,
  onClose,
  onSubmit
}: PrinterAssignmentModalProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(printer?.device_id || '');
  const [role, setRole] = useState<PrinterRole>(printer?.role || 'bw');
  const [isDefault, setIsDefault] = useState<boolean>(printer?.is_default || false);

  if (!isOpen || !printer) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      printer_id: printer.id,
      device_id: selectedDeviceId ? selectedDeviceId : null,
      role,
      is_default: isDefault
    });
  };

  const activeDevices = devices.filter(d => !d.is_revoked);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assignment-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 id="assignment-modal-title" className="text-base font-bold text-slate-900">
              Configure Printer Assignment & Roles
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Assign {printer.name} to a paired shop Windows PC and define routing behavior.
            </p>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
            aria-label="Close assignment dialog"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Windows Agent Device Select */}
          <div>
            <label htmlFor="device-select" className="block font-bold text-slate-800 mb-1">
              Assigned Windows Agent Device:
            </label>
            <select
              id="device-select"
              value={selectedDeviceId}
              onChange={e => setSelectedDeviceId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">-- Unassigned (Disabled for Remote Auto-Spooling) --</option>
              {activeDevices.map(device => (
                <option key={device.id} value={device.id}>
                  {device.device_name} (v{device.agent_version})
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Only Windows PCs running the paired CAPS Desktop Agent for this shop can claim and print jobs.
            </p>
          </div>

          {/* Printer Role */}
          <div>
            <label htmlFor="role-select" className="block font-bold text-slate-800 mb-1">
              Printer Routing Role:
            </label>
            <select
              id="role-select"
              value={role}
              onChange={e => setRole(e.target.value as PrinterRole)}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            >
              <option value="bw">B/W Laser (High-Speed Document Spooler)</option>
              <option value="color">Color Multi-Function (Color & Photo Prints)</option>
              <option value="large_format">Large Format (Plotter / Architectural Drawings)</option>
            </select>
          </div>

          {/* Default Checkbox */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={e => setIsDefault(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div className="ml-2.5">
                <span className="font-bold text-slate-900">Make Default Shop Printer</span>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  New queue orders with standard specifications will automatically route to this printer.
                </p>
              </div>
            </label>
          </div>

          {/* Driver Capability Snapshot */}
          <div className="rounded-lg bg-slate-100/70 p-3 space-y-1 text-[11px] text-slate-600">
            <span className="font-bold text-slate-800">Verified Driver Capabilities:</span>
            <div className="grid grid-cols-2 gap-1 pt-1">
              <span>Duplex: {printer.capabilities.duplex_supported ? 'Supported' : 'No'}</span>
              <span>Color: {printer.capabilities.color_modes.join(', ')}</span>
              <span>Paper: {printer.capabilities.paper_sizes.join(', ')}</span>
              <span>Max Copies: {printer.capabilities.max_copies}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {isSubmitting && (
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
              <span>{isSubmitting ? 'Saving...' : 'Save Assignment'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
