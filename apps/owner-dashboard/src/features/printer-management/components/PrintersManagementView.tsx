'use client';

/**
 * PrintersManagementView Component.
 * Master view for discovering and managing physical printers, driver capabilities,
 * Windows agent assignments, ephemeral device pairing, and default routing.
 */

import React, { useState } from 'react';
import { usePrinters } from '../hooks/use-printers';
import { PrinterCard } from './PrinterCard';
import { PrinterAssignmentModal } from './PrinterAssignmentModal';
import { CapabilityChangeAlert } from './CapabilityChangeAlert';
import { detectCapabilityDifferences } from '../printer-service';
import { AgentDeviceList } from '../../agent-monitoring/components/AgentDeviceList';
import { AgentPairingModal } from '../../agent-monitoring/components/AgentPairingModal';
import { RevokeAgentModal } from '../../agent-monitoring/components/RevokeAgentModal';
import { useAgentDevices } from '../../agent-monitoring/hooks/use-agent-devices';
import type { Printer, PrinterRole, DriverCapabilities } from '../types';
import type { AgentDeviceStatus } from '../../agent-monitoring/types';

export interface PrintersManagementViewProps {
  shopId?: string | undefined;
}

export function PrintersManagementView({
  shopId = '00000000-0000-0000-0000-000000000001'
}: PrintersManagementViewProps) {
  const {
    printers,
    devices: printerAgentDevices,
    isLoading: isLoadingPrinters,
    isUpdating: isUpdatingPrinters,
    error: printerError,
    refreshPrinters,
    updateAssignment,
    clearError: clearPrinterError
  } = usePrinters({ shopId });

  const {
    devices: agentStatuses,
    isLoading: isLoadingAgents,
    isPairing,
    isRevoking,
    activePairingCode,
    error: agentError,
    generateCode,
    revokeDevice,
    clearPairingCode,
    clearError: clearAgentError
  } = useAgentDevices({ shopId });

  const [selectedPrinterForModal, setSelectedPrinterForModal] = useState<Printer | null>(null);
  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
  const [deviceToRevoke, setDeviceToRevoke] = useState<AgentDeviceStatus | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const handleSaveAssignment = async (input: {
    printer_id: string;
    device_id: string | null;
    role: PrinterRole;
    is_default: boolean;
  }) => {
    const success = await updateAssignment(input);
    if (success) {
      setSuccessBanner('Printer assignment updated successfully!');
      setSelectedPrinterForModal(null);
      setTimeout(() => setSuccessBanner(null), 4000);
    }
  };

  const handleRevokeConfirm = async (deviceId: string, reason: string) => {
    const res = await revokeDevice(deviceId, reason);
    if (res) {
      setSuccessBanner(`Device successfully revoked: ${res.reason}`);
      setDeviceToRevoke(null);
      await refreshPrinters();
      setTimeout(() => setSuccessBanner(null), 4000);
    }
  };

  const handleStartPairing = () => {
    setIsPairingModalOpen(true);
    void generateCode();
  };

  // Expected baseline capabilities for comparison
  const baselineCapabilities: DriverCapabilities = {
    paper_sizes: ['a4', 'a3'],
    color_modes: ['bw', 'color'],
    duplex_supported: true,
    max_copies: 99
  };

  const activeError = printerError || agentError;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Physical Printers & Desktop Agents</h1>
          <p className="mt-1 text-xs text-slate-500">
            Discovered local Windows printers, driver capabilities, and paired Windows print agent
            PCs.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => void refreshPrinters()}
            disabled={isLoadingPrinters || isUpdatingPrinters}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <svg
              className={`h-3.5 w-3.5 ${isLoadingPrinters ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Scan / Refresh</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {successBanner && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800"
        >
          <div className="flex items-center space-x-2">
            <span>✅</span>
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-600 hover:text-emerald-900"
          >
            ✕
          </button>
        </div>
      )}

      {activeError && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800"
        >
          <div className="flex items-center space-x-2">
            <span>⚠️</span>
            <span>{activeError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearPrinterError();
              clearAgentError();
            }}
            className="text-rose-600 hover:text-rose-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* Section 1: Paired Windows Print Agents */}
      <AgentDeviceList
        devices={agentStatuses}
        isLoading={isLoadingAgents}
        onPairNew={handleStartPairing}
        onRevoke={setDeviceToRevoke}
        disabled={isRevoking}
      />

      {/* Capability Alerts for Monitored Printers */}
      {printers.map(p => {
        const diff = detectCapabilityDifferences(baselineCapabilities, p.capabilities);
        if (diff.hasDifferences) {
          return (
            <CapabilityChangeAlert key={`alert-${p.id}`} difference={diff} printerName={p.name} />
          );
        }
        return null;
      })}

      {/* Section 2: Printers List */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900">Configured Physical Printers</h2>
        {isLoadingPrinters ? (
          <div className="space-y-4 py-4" role="status" aria-label="Loading printers">
            {[1, 2].map(i => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
              />
            ))}
          </div>
        ) : printers.length === 0 ? (
          <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
            <span className="text-3xl block mb-2">🖨️</span>
            <h3 className="text-sm font-bold text-slate-900">No physical printers discovered</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Pair a Windows PC running the CAPS Desktop Agent above to auto-discover installed
              printers.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {printers.map(printer => (
              <PrinterCard
                key={printer.id}
                printer={printer}
                disabled={isUpdatingPrinters}
                onEditAssignment={setSelectedPrinterForModal}
              />
            ))}
          </div>
        )}
      </div>

      {/* Printer Assignment Modal */}
      <PrinterAssignmentModal
        isOpen={selectedPrinterForModal !== null}
        printer={selectedPrinterForModal}
        devices={printerAgentDevices}
        isSubmitting={isUpdatingPrinters}
        onClose={() => setSelectedPrinterForModal(null)}
        onSubmit={handleSaveAssignment}
      />

      {/* Agent Pairing Code Modal */}
      <AgentPairingModal
        isOpen={isPairingModalOpen}
        activeCode={activePairingCode}
        isGenerating={isPairing}
        onClose={() => {
          setIsPairingModalOpen(false);
          clearPairingCode();
        }}
        onGenerateNew={generateCode}
      />

      {/* Revoke Agent Confirmation Modal */}
      <RevokeAgentModal
        isOpen={deviceToRevoke !== null}
        device={deviceToRevoke}
        isRevoking={isRevoking}
        onClose={() => setDeviceToRevoke(null)}
        onConfirm={handleRevokeConfirm}
      />
    </div>
  );
}
