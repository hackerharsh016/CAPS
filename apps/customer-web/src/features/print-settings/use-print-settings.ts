'use client';

/**
 * Custom React Hook for Managing CAPS Customer Web Print Settings (P04-M04-F01).
 * Handles reactive field updates, live validation, page & sheet calculations,
 * and optional draft preservation in sessionStorage.
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
import {
  DEFAULT_PRINT_SETTINGS,
  validatePrintSettings
} from './validation';

export interface UsePrintSettingsOptions {
  initialSettings?: Partial<PrintSettings> | undefined;
  totalDocumentPages?: number | undefined;
  storageKey?: string | undefined;
}

export interface UsePrintSettingsReturn {
  settings: PrintSettings;
  errors: PrintSettingsValidationErrors;
  isValid: boolean;
  isDirty: boolean;
  calculation: PrintSettingsCalculation | undefined;
  updatePaperSize: (paper_size: PaperSize) => void;
  updateColorMode: (color_mode: ColorMode) => void;
  updateSides: (sides: SideMode) => void;
  updateOrientation: (orientation: Orientation) => void;
  updateCopies: (copies: number) => void;
  updatePageRange: (page_range: string) => void;
  updateBinding: (binding: BindingType) => void;
  updateSettings: (partial: Partial<PrintSettings>) => void;
  resetSettings: () => void;
  validateNow: () => boolean;
}

export function usePrintSettings({
  initialSettings,
  totalDocumentPages,
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

  // 2. Compute Validation & Calculations live
  const validation = useMemo(() => {
    return validatePrintSettings(settings, totalDocumentPages);
  }, [settings, totalDocumentPages]);

  // 3. Save draft to sessionStorage if key provided
  useEffect(() => {
    if (typeof window !== 'undefined' && storageKey && isDirty) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(settings));
      } catch {
        // Ignore storage quota or disabled storage errors
      }
    }
  }, [settings, storageKey, isDirty]);

  // 4. Update handlers
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
    const result = validatePrintSettings(settings, totalDocumentPages);
    return result.isValid;
  }, [settings, totalDocumentPages]);

  return {
    settings,
    errors: validation.errors,
    isValid: validation.isValid,
    isDirty,
    calculation: validation.calculation,
    updatePaperSize,
    updateColorMode,
    updateSides,
    updateOrientation,
    updateCopies,
    updatePageRange,
    updateBinding,
    updateSettings,
    resetSettings,
    validateNow
  };
}
