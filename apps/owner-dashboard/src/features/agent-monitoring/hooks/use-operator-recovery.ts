'use client';

/**
 * useOperatorRecovery Hook for CAPS Owner Dashboard.
 * Encapsulates:
 * - Active hardware incident detection and dismissal
 * - Agent connectivity telemetry tracking
 * - Ambiguous print outcome resolution submission
 * - Evidence requirement validation
 */

import { useState, useCallback, useEffect } from 'react';
import { defaultRecoveryService, OperatorRecoveryError } from '../operator-recovery-service';
import type {
  HardwareIncident,
  AgentDeviceStatus,
  AmbiguousOutcomeResolution,
  ResolveUnresolvedJobResponse
} from '../types';

export interface UseOperatorRecoveryOptions {
  shopId: string;
  onSuccess?: ((response: ResolveUnresolvedJobResponse) => void) | undefined;
}

export interface UseOperatorRecoveryReturn {
  incidents: HardwareIncident[];
  agentStatus: AgentDeviceStatus | null;
  isResolving: boolean;
  error: string | null;
  dismissIncident: (incidentId: string) => void;
  resolveJob: (
    jobId: string,
    resolution: AmbiguousOutcomeResolution,
    evidenceConfirmed: boolean,
    notes?: string
  ) => Promise<ResolveUnresolvedJobResponse | null>;
  refreshIncidents: () => Promise<void>;
  clearError: () => void;
}

export function useOperatorRecovery({
  shopId,
  onSuccess
}: UseOperatorRecoveryOptions): UseOperatorRecoveryReturn {
  const [incidents, setIncidents] = useState<HardwareIncident[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentDeviceStatus | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refreshIncidents = useCallback(async () => {
    if (!shopId) return;
    try {
      const [fetchedIncidents, fetchedAgent] = await Promise.all([
        defaultRecoveryService.fetchActiveIncidents(shopId),
        defaultRecoveryService.fetchAgentDeviceStatus(shopId)
      ]);
      setIncidents(fetchedIncidents);
      setAgentStatus(fetchedAgent);
    } catch {
      // Non-blocking telemetry failure
    }
  }, [shopId]);

  useEffect(() => {
    void refreshIncidents();
    const interval = setInterval(() => {
      void refreshIncidents();
    }, 15000);
    return () => clearInterval(interval);
  }, [refreshIncidents]);

  const dismissIncident = useCallback((incidentId: string) => {
    setIncidents(prev => prev.filter(i => i.id !== incidentId));
  }, []);

  const resolveJob = useCallback(
    async (
      jobId: string,
      resolution: AmbiguousOutcomeResolution,
      evidenceConfirmed: boolean,
      notes?: string
    ): Promise<ResolveUnresolvedJobResponse | null> => {
      setIsResolving(true);
      setError(null);

      try {
        const response = await defaultRecoveryService.resolveUnresolvedJob({
          jobId,
          shopId,
          resolution,
          physicalEvidenceConfirmed: evidenceConfirmed,
          ...(notes !== undefined ? { notes } : {})
        });

        onSuccess?.(response);
        return response;
      } catch (err: unknown) {
        let msg = 'An unexpected error occurred while resolving job.';
        if (err instanceof OperatorRecoveryError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setError(msg);
        return null;
      } finally {
        setIsResolving(false);
      }
    },
    [shopId, onSuccess]
  );

  return {
    incidents,
    agentStatus,
    isResolving,
    error,
    dismissIncident,
    resolveJob,
    refreshIncidents,
    clearError
  };
}
