'use client';

/**
 * usePrinters Hook for CAPS Owner Dashboard.
 * Encapsulates:
 * - Querying physical printers and paired Windows devices for a shop
 * - Updating printer assignment, role, and default status
 * - Tracking capability difference alerts across printers
 */

import { useState, useCallback, useEffect } from 'react';
import { defaultPrinterService, PrinterManagementError } from '../printer-service';
import type { Printer, AgentDevice, UpdatePrinterAssignmentInput } from '../types';

export interface UsePrintersOptions {
  shopId: string;
}

export interface UsePrintersReturn {
  printers: Printer[];
  devices: AgentDevice[];
  isLoading: boolean;
  isUpdating: boolean;
  error: string | null;
  refreshPrinters: () => Promise<void>;
  updateAssignment: (input: Omit<UpdatePrinterAssignmentInput, 'shop_id'>) => Promise<boolean>;
  clearError: () => void;
}

export function usePrinters({ shopId }: UsePrintersOptions): UsePrintersReturn {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [devices, setDevices] = useState<AgentDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const refreshPrinters = useCallback(async () => {
    if (!shopId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [fetchedPrinters, fetchedDevices] = await Promise.all([
        defaultPrinterService.fetchShopPrinters(shopId),
        defaultPrinterService.fetchShopAgentDevices(shopId)
      ]);
      setPrinters(fetchedPrinters);
      setDevices(fetchedDevices);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch shop printers.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    void refreshPrinters();
  }, [refreshPrinters]);

  const updateAssignment = useCallback(
    async (input: Omit<UpdatePrinterAssignmentInput, 'shop_id'>): Promise<boolean> => {
      if (!shopId) return false;
      setIsUpdating(true);
      setError(null);
      try {
        await defaultPrinterService.updatePrinterAssignment({
          ...input,
          shop_id: shopId
        });
        await refreshPrinters();
        return true;
      } catch (err: unknown) {
        let msg = 'Failed to update printer assignment.';
        if (err instanceof PrinterManagementError) {
          msg = err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        setError(msg);
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    [shopId, refreshPrinters]
  );

  return {
    printers,
    devices,
    isLoading,
    isUpdating,
    error,
    refreshPrinters,
    updateAssignment,
    clearError
  };
}
