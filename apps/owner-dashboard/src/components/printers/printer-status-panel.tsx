'use client';

/**
 * Owner Dashboard Hardware Status & Alerting Panel (INT-D2-04).
 * Displays live printer health telemetry (toner, paper, jams, online state),
 * prominent visual alert banners for critical hardware faults,
 * and manual "Retry Print" actions for failed print jobs.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { PrinterTelemetry, HardwareErrorState } from '../../services/api/printer.service';
import { PrinterApiService } from '../../services/api/printer.service';

export interface FailedJobItem {
  id: string;
  document_name?: string;
  customer_name?: string;
  error_code?: string;
  error_message?: string;
}

export interface PrinterStatusPanelProps {
  shopId: string;
  printers?: PrinterTelemetry[] | undefined;
  failedJobs?: FailedJobItem[] | undefined;
  onRetryJob?: ((jobId: string) => Promise<void> | void) | undefined;
  apiService?: PrinterApiService | undefined;
  className?: string | undefined;
}

export function PrinterStatusPanel({
  shopId,
  printers: initialPrinters,
  failedJobs: initialFailedJobs,
  onRetryJob,
  apiService,
  className = ''
}: PrinterStatusPanelProps) {
  const [service] = useState(() => apiService || new PrinterApiService());
  const [printers, setPrinters] = useState<PrinterTelemetry[]>(() => initialPrinters || []);
  const [failedJobs, setFailedJobs] = useState<FailedJobItem[]>(() => initialFailedJobs || []);
  const [loading, setLoading] = useState<boolean>(!initialPrinters);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [retrySuccessIds, setRetrySuccessIds] = useState<Set<string>>(new Set());

  // Update printers if initialPrinters prop changes
  useEffect(() => {
    if (initialPrinters) {
      setPrinters(initialPrinters);
    }
  }, [initialPrinters]);

  // Update failed jobs if initialFailedJobs prop changes
  useEffect(() => {
    if (initialFailedJobs) {
      setFailedJobs(initialFailedJobs);
    }
  }, [initialFailedJobs]);

  // Fetch live printers if not passed via props
  const fetchTelemetry = useCallback(async () => {
    if (!shopId) return;
    try {
      setLoading(true);
      setFetchError(null);
      const data = await service.getPrinters(shopId);
      setPrinters(data);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch printer telemetry');
    } finally {
      setLoading(false);
    }
  }, [shopId, service]);

  useEffect(() => {
    if (!initialPrinters) {
      fetchTelemetry();
    }
  }, [fetchTelemetry, initialPrinters]);

  // Subscribe to live Realtime broadcast event: `agent.status`
  useEffect(() => {
    if (!shopId) return;

    const unsubscribe = service.subscribeToAgentStatus(shopId, update => {
      setPrinters(prevPrinters => {
        const index = prevPrinters.findIndex(p => p.id === update.id || p.name === update.name);
        if (index === -1) {
          // If brand new printer reported by agent, append
          if (update.id && update.name) {
            return [...prevPrinters, update as PrinterTelemetry];
          }
          return prevPrinters;
        }

        const updated = [...prevPrinters];
        updated[index] = {
          ...updated[index],
          ...update,
          status: update.status || updated[index].status,
          is_online: update.is_online !== undefined ? update.is_online : updated[index].is_online,
          error_state: update.error_state || updated[index].error_state,
          toner_level: update.toner_level !== undefined ? update.toner_level : updated[index].toner_level
        };
        return updated;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [shopId, service]);

  // Handle Retry Print
  const handleRetryJob = async (jobId: string) => {
    if (retryingIds.has(jobId)) return;

    setRetryingIds(prev => new Set(prev).add(jobId));
    try {
      if (onRetryJob) {
        await onRetryJob(jobId);
      } else {
        await service.retryJob(shopId, jobId);
      }

      setRetrySuccessIds(prev => new Set(prev).add(jobId));
      // Remove from failed list after brief feedback delay
      setTimeout(() => {
        setFailedJobs(prev => prev.filter(j => j.id !== jobId));
      }, 1500);
    } catch (err: any) {
      alert(`Retry failed: ${err?.message || err}`);
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  // Collect active hardware alerts across all printers
  const criticalAlerts: Array<{
    id: string;
    printerName: string;
    type: 'OFFLINE' | 'PAPER_OUT' | 'JAMMED' | 'LOW_TONER' | 'ERROR';
    message: string;
    severity: 'danger' | 'warning';
  }> = [];

  printers.forEach(printer => {
    const isOffline = !printer.is_online || printer.status === 'OFFLINE' || printer.error_state === 'OFFLINE';
    const isPaperOut = printer.error_state === 'PAPER_OUT';
    const isJammed = printer.error_state === 'JAMMED';
    const isLowToner =
      printer.error_state === 'LOW_TONER' ||
      (printer.toner_level !== undefined && printer.toner_level <= 15);

    if (isJammed) {
      criticalAlerts.push({
        id: `${printer.id}-jammed`,
        printerName: printer.name,
        type: 'JAMMED',
        message: `Alert: Printer "${printer.name}" has a HARDWARE PAPER JAM. Please clear paper path before printing resumes.`,
        severity: 'danger'
      });
    } else if (isPaperOut) {
      criticalAlerts.push({
        id: `${printer.id}-paperout`,
        printerName: printer.name,
        type: 'PAPER_OUT',
        message: `Alert: Printer "${printer.name}" is OUT OF PAPER. Please refill paper tray.`,
        severity: 'danger'
      });
    } else if (isOffline) {
      criticalAlerts.push({
        id: `${printer.id}-offline`,
        printerName: printer.name,
        type: 'OFFLINE',
        message: `Alert: Printer "${printer.name}" is OFFLINE. Check USB cable, power, and Print Agent desktop connectivity.`,
        severity: 'danger'
      });
    }

    if (isLowToner && !isOffline) {
      criticalAlerts.push({
        id: `${printer.id}-toner`,
        printerName: printer.name,
        type: 'LOW_TONER',
        message: `Warning: Printer "${printer.name}" toner is low (${printer.toner_level ?? 0}% remaining). Replacement cartridge recommended.`,
        severity: 'warning'
      });
    }
  });

  return (
    <div className={`space-y-6 ${className}`} data-testid="printer-status-panel">
      {/* 1. Header & Live Indicator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span>Hardware Status & Alerting</span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800"
              title="Telemetry actively synced via agent.status"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
              Live Telemetry
            </span>
          </h2>
          <p className="text-sm text-gray-500">
            Real-time Win32 spooler hardware monitoring, paper/toner telemetry, and agent alerts.
          </p>
        </div>

        <button
          onClick={fetchTelemetry}
          disabled={loading}
          className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh Telemetry'}
        </button>
      </div>

      {/* 2. Prominent Hardware Alert Banners */}
      {criticalAlerts.length > 0 && (
        <div className="space-y-3" data-testid="hardware-alert-banners">
          {criticalAlerts.map(alert => {
            const isDanger = alert.severity === 'danger';
            return (
              <div
                key={alert.id}
                role="alert"
                className={`p-4 rounded-lg border flex items-start justify-between gap-3 shadow-sm ${
                  isDanger
                    ? 'bg-red-50 border-red-300 text-red-900'
                    : 'bg-amber-50 border-amber-300 text-amber-900'
                }`}
                data-alert-type={alert.type}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl" aria-hidden="true">
                    {alert.type === 'JAMMED' && '⚠️'}
                    {alert.type === 'PAPER_OUT' && '📄'}
                    {alert.type === 'OFFLINE' && '🔌'}
                    {alert.type === 'LOW_TONER' && '🖨️'}
                  </span>
                  <div>
                    <h3 className="font-semibold text-sm">
                      {alert.type === 'JAMMED' && 'Printer Hardware Jam'}
                      {alert.type === 'PAPER_OUT' && 'Paper Out'}
                      {alert.type === 'OFFLINE' && 'Printer Offline'}
                      {alert.type === 'LOW_TONER' && 'Low Toner Warning'}
                    </h3>
                    <p className="text-sm mt-0.5">{alert.message}</p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded font-bold uppercase tracking-wider ${
                    isDanger ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'
                  }`}
                >
                  {alert.type}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {fetchError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {fetchError}
        </div>
      )}

      {/* 3. Printer Telemetry Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {printers.map(printer => {
          const isOffline = !printer.is_online || printer.status === 'OFFLINE';
          const toner = printer.toner_level ?? 100;

          return (
            <div
              key={printer.id}
              className={`p-5 rounded-xl border bg-white shadow-sm flex flex-col justify-between transition-all ${
                isOffline ? 'border-gray-300 bg-gray-50/60' : 'border-gray-200 hover:border-gray-300'
              }`}
              data-testid={`printer-card-${printer.id}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-base">{printer.name}</h3>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {printer.id.slice(0, 8)}</p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      printer.status === 'ONLINE'
                        ? 'bg-emerald-100 text-emerald-800'
                        : printer.status === 'BUSY'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                        printer.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                    />
                    {printer.status}
                  </span>
                </div>

                {/* Hardware Status Details */}
                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-gray-600">
                    <span>Hardware Status:</span>
                    <span
                      className={`font-semibold ${
                        printer.error_state === 'NONE' || !printer.error_state
                          ? 'text-emerald-700'
                          : 'text-red-600 font-bold'
                      }`}
                    >
                      {printer.error_state && printer.error_state !== 'NONE'
                        ? printer.error_state
                        : 'READY'}
                    </span>
                  </div>

                  {/* Toner Level Meter */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-gray-600">
                      <span>Toner / Ink Level:</span>
                      <span className="font-medium text-gray-800">
                        {printer.toner_level !== undefined ? `${printer.toner_level}%` : 'N/A'}
                      </span>
                    </div>
                    {printer.toner_level !== undefined && (
                      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            toner > 50
                              ? 'bg-emerald-500'
                              : toner > 20
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${toner}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {printer.error_message && (
                <div className="mt-4 pt-3 border-t border-gray-100 text-xs text-red-600">
                  ⚠️ {printer.error_message}
                </div>
              )}
            </div>
          );
        })}

        {printers.length === 0 && !loading && (
          <div className="col-span-full py-8 text-center text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-xl">
            No registered printers found for this shop.
          </div>
        )}
      </div>

      {/* 4. Failed Print Jobs & Manual Retry Section */}
      {failedJobs.length > 0 && (
        <div className="mt-8 border-t border-gray-200 pt-6" data-testid="failed-jobs-section">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <span>Failed Print Jobs ({failedJobs.length})</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">
                  Action Required
                </span>
              </h3>
              <p className="text-xs text-gray-500">
                Jobs that failed due to printer offline, paper jam, or spooler timeout. Review hardware before retrying.
              </p>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm divide-y divide-gray-100">
            {failedJobs.map(job => {
              const isRetrying = retryingIds.has(job.id);
              const isRetried = retrySuccessIds.has(job.id);

              return (
                <div
                  key={job.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50"
                  data-testid={`failed-job-row-${job.id}`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900">
                        {job.document_name || 'Customer Document'}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">({job.id})</span>
                    </div>
                    <div className="text-xs text-red-600 flex items-center gap-1.5">
                      <span>Error:</span>
                      <span className="font-mono font-bold">{job.error_code || 'PRINTER_ERROR'}</span>
                      {job.error_message && <span>— {job.error_message}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {isRetried ? (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800">
                        ✓ Re-Queued
                      </span>
                    ) : (
                      <button
                        onClick={() => handleRetryJob(job.id)}
                        disabled={isRetrying}
                        className="inline-flex items-center px-3.5 py-1.5 text-xs font-semibold rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        data-testid={`retry-button-${job.id}`}
                      >
                        {isRetrying ? 'Retrying...' : 'Retry Print'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
