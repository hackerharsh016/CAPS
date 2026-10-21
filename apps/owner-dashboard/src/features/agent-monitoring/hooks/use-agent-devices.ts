'use client';

/**
 * useAgentDevices Hook for CAPS Owner Dashboard.
 * Encapsulates:
 * - Querying paired Windows agent devices and real-time connectivity status
 * - Generating ephemeral 8-character pairing codes with countdown timer
 * - Revoking compromised or retired agent devices
 */

import { useState, useCallback, useEffect } from 'react';
import { defaultAgentPairingService, AgentPairingError } from '../agent-pairing-service';
import type {
  AgentDeviceStatus,
  GeneratePairingCodeResponse,
  RevokeAgentDeviceResponse
} from '../types';

export interface UseAgentDevicesOptions {
  shopId: string;
}

export interface UseAgentDevicesReturn {
  devices: AgentDeviceStatus[];
  isLoading: boolean;
  isPairing: boolean;
  isRevoking: boolean;
  activePairingCode: GeneratePairingCodeResponse | null;
  error: string | null;
  refreshDevices: () => Promise<void>;
  generateCode: (ttlSeconds?: number) => Promise<GeneratePairingCodeResponse | null>;
  revokeDevice: (deviceId: string, reason: string) => Promise<RevokeAgentDeviceResponse | null>;
  clearPairingCode: () => void;
  clearError: () => void;
}

export function useAgentDevices({ shopId }: UseAgentDevicesOptions): UseAgentDevicesReturn {
  const [devices, setDevices] = useState<AgentDeviceStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [activePairingCode, setActivePairingCode] = useState<GeneratePairingCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);
  const clearPairingCode = useCallback(() => setActivePairingCode(null), []);

  const refreshDevices = useCallback(async () => {
    if (!shopId) return;
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await defaultAgentPairingService.fetchShopAgentDevices(shopId);
      setDevices(fetched);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch agent devices.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void refreshDevices();
    const interval = setInterval(() => {
      void refreshDevices();
    }, 15000); // Poll agent heartbeats every 15s
    return () => clearInterval(interval);
  }, [refreshDevices]);

  const generateCode = useCallback(
    async (ttlSeconds: number = 600): Promise<GeneratePairingCodeResponse | null> => {
      if (!shopId) return null;
      setIsPairing(true);
      setError(null);
      try {
        const response = await defaultAgentPairingService.generatePairingCode({
          shopId,
          ttlSeconds
        });
        setActivePairingCode(response);
        return response;
      } catch (err: unknown) {
        let msg = 'Failed to generate pairing code.';
        if (err instanceof AgentPairingError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setError(msg);
        return null;
      } finally {
        setIsPairing(false);
      }
    },
    [shopId]
  );

  const revokeDevice = useCallback(
    async (deviceId: string, reason: string): Promise<RevokeAgentDeviceResponse | null> => {
      if (!shopId) return null;
      setIsRevoking(true);
      setError(null);
      try {
        const response = await defaultAgentPairingService.revokeAgentDevice({
          deviceId,
          shopId,
          reason
        });
        await refreshDevices();
        return response;
      } catch (err: unknown) {
        let msg = 'Failed to revoke device.';
        if (err instanceof AgentPairingError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setError(msg);
        return null;
      } finally {
        setIsRevoking(false);
      }
    },
    [shopId, refreshDevices]
  );

  return {
    devices,
    isLoading,
    isPairing,
    isRevoking,
    activePairingCode,
    error,
    refreshDevices,
    generateCode,
    revokeDevice,
    clearPairingCode,
    clearError
  };
}
