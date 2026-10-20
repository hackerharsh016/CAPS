'use client';

/**
 * Custom React Hook for Managing CAPS Customer Web Print Settings (P04-M04-F01 / P04-M04-F02).
 * Handles reactive field updates, live validation, page & sheet calculations,
 * printer hardware capability constraints, and optional draft preservation in sessionStorage.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  PrintSettings,
  PaperSize,
  ColorMode,
  SideMode,
  Orientation,
  BindingType,
  PrintSettingsValidationErrors,
  PrintSettingsCalculation
} from './types';
import type {
  ShopPrinterCapabilities,
  CapabilityCheckResult
} from './capabilities-types';
import {
  DEFAULT_PRINT_SETTINGS,
  validatePrintSettings
} from './validation';
import { checkSettingsCompatibility } from './capabilities-service';

export interface UsePrintSettingsOptions {
  initialSettings?: Partial<PrintSettings> | undefined;
  totalDocumentPages?: number | undefined;
  capabilities?: ShopPrinterCapabilities | undefined;
  storageKey?: string | undefined;
}

export interface UsePrintSettingsReturn {
  settings: PrintSettings;
  errors: PrintSettingsValidationErrors;
  isValid: boolean;
  isDirty: boolean;
  calculation: PrintSettingsCalculation | undefined;
  capabilityCheck: CapabilityCheckResult | undefined;
  updatePaperSize: (paper_size: PaperSize) => void;
  updateColorMode: (color_mode: ColorMode) => void;
  updateSides: (sides: SideMode) => void;
  updateOrientation: (orientation: Orientation) => void;
  updateCopies: (copies: number) => void;
  updatePageRange: (page_range: string) => void;
  updateBinding: (binding: BindingType) => void;
  updateSettings: (partial: Partial<PrintSettings>) => void;
  applyCompatibleSettings: () => void;
  resetSettings: () => void;
  validateNow: () => boolean;
}

export function usePrintSettings({
  initialSettings,
  totalDocumentPages,
  capabilities,
  storageKey
}: UsePrintSettingsOptions = {}): UsePrintSettingsReturn {
  // 1. Initial State Resolution (Storage draft -> initialSettings -> default)
  const [settings, setSettings] = useState<PrintSettings>(() => {
    if (typeof window !== 'undefined' && storageKey) {
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...DEFAULT_PRINT_SETTINGS, ...parsed };
        }
      } catch {
        // Fall back to props/defaults
      }
    }
    return { ...DEFAULT_PRINT_SETTINGS, ...initialSettings };
  });

  const [isDirty, setIsDirty] = useState<boolean>(false);

  // 2. Compute Base Validation & Calculations live
  const baseValidation = useMemo(() => {
    return validatePrintSettings(settings, totalDocumentPages);
  }, [settings, totalDocumentPages]);

  // 3. Compute Capability Compatibility Check live
  const capabilityCheck = useMemo(() => {
    if (!capabilities) return undefined;
    return checkSettingsCompatibility(settings, capabilities);
  }, [settings, capabilities]);

  // 4. Merge Validation Errors with Hardware Incompatibilities
  const { combinedErrors, isFullyValid } = useMemo(() => {
    const errors: PrintSettingsValidationErrors = { ...baseValidation.errors };

    if (capabilities && capabilityCheck) {
      if (capabilities.online_printers_count === 0) {
        errors._general =
          capabilities.status_notice || 'All printers at this shop are currently offline.';
      }

      for (const inc of capabilityCheck.incompatibilities) {
        if (inc.field === 'paper_size') {
          errors.paper_size = inc.reason;
        } else if (inc.field === 'color_mode') {
          errors.color_mode = inc.reason;
        } else if (inc.field === 'sides') {
          errors.sides = inc.reason;
        } else if (inc.field === 'copies') {
          errors.copies = inc.reason;
        }
      }
    }

    const hasAnyErrors = Object.keys(errors).length > 0;
    return {
      combinedErrors: errors,
      isFullyValid: baseValidation.isValid && (!capabilityCheck || capabilityCheck.isCompatible) && !hasAnyErrors
    };
  }, [baseValidation, capabilities, capabilityCheck]);

  // 5. Save draft to sessionStorage if key provided
  useEffect(() => {
    if (typeof window !== 'undefined' && storageKey && isDirty) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(settings));
      } catch {
        // Ignore storage quota or disabled storage errors
      }
    }
  }, [settings, storageKey, isDirty]);

  // 6. Update handlers
  const updateSettings = useCallback((partial: Partial<PrintSettings>) => {
    setIsDirty(true);
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const updatePaperSize = useCallback((paper_size: PaperSize) => {
    updateSettings({ paper_size });
  }, [updateSettings]);

  const updateColorMode = useCallback((color_mode: ColorMode) => {
    updateSettings({ color_mode });
  }, [updateSettings]);

  const updateSides = useCallback((sides: SideMode) => {
    updateSettings({ sides });
  }, [updateSettings]);

  const updateOrientation = useCallback((orientation: Orientation) => {
    updateSettings({ orientation });
  }, [updateSettings]);

  const updateCopies = useCallback((copies: number) => {
    updateSettings({ copies });
  }, [updateSettings]);

  const updatePageRange = useCallback((page_range: string) => {
    updateSettings({ page_range });
  }, [updateSettings]);

  const updateBinding = useCallback((binding: BindingType) => {
    updateSettings({ binding });
  }, [updateSettings]);

  /**
   * Applies suggested compatible settings explicitly requested by user.
   * NEVER happens silently.
   */
  const applyCompatibleSettings = useCallback(() => {
    if (!capabilities || !capabilityCheck) return;

    const patches: Partial<PrintSettings> = {};
    for (const inc of capabilityCheck.incompatibilities) {
      if (inc.field === 'paper_size') {
        patches.paper_size = inc.suggestedValue as PaperSize;
      } else if (inc.field === 'color_mode') {
        patches.color_mode = inc.suggestedValue as ColorMode;
      } else if (inc.field === 'sides') {
        patches.sides = inc.suggestedValue as SideMode;
      } else if (inc.field === 'copies') {
        patches.copies = Number(inc.suggestedValue);
      }
    }

    if (Object.keys(patches).length > 0) {
      updateSettings(patches);
    }
  }, [capabilities, capabilityCheck, updateSettings]);

  const resetSettings = useCallback(() => {
    if (typeof window !== 'undefined' && storageKey) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Ignore
      }
    }
    setIsDirty(false);
    setSettings({ ...DEFAULT_PRINT_SETTINGS, ...initialSettings });
  }, [initialSettings, storageKey]);

  const validateNow = useCallback((): boolean => {
    const base = validatePrintSettings(settings, totalDocumentPages);
    if (!base.isValid) return false;
    if (capabilities) {
      const cap = checkSettingsCompatibility(settings, capabilities);
      if (!cap.isCompatible) return false;
    }
    return true;
  }, [settings, totalDocumentPages, capabilities]);

  return {
    settings,
    errors: combinedErrors,
    isValid: isFullyValid,
    isDirty,
    calculation: baseValidation.calculation,
    capabilityCheck,
    updatePaperSize,
    updateColorMode,
    updateSides,
    updateOrientation,
    updateCopies,
    updatePageRange,
    updateBinding,
    updateSettings,
    applyCompatibleSettings,
    resetSettings,
    validateNow
  };
}
