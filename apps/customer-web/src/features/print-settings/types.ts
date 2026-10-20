/**
 * Domain types for CAPS Customer Web Print Settings (P04-M04-F01).
 * Strictly mirrors the frozen contract from @caps/types/settings.
 */

export type PaperSize = 'A4' | 'A3' | 'Legal';

export type ColorMode = 'bw' | 'color';

export type SideMode = 'single' | 'double';

export type Orientation = 'portrait' | 'landscape';

export type BindingType = 'none' | 'spiral' | 'staple' | 'lamination';

export interface PrintSettings {
  /** Paper dimensions target */
  paper_size: PaperSize;
  /** Color reproduction mode */
  color_mode: ColorMode;
  /** Single or double-sided printing */
  sides: SideMode;
  /** Page orientation */
  orientation: Orientation;
  /** Copy count between 1 and 100 inclusive */
  copies: number;
  /** Page range specification: 'all' or comma/dash separated numbers, e.g. '1-5, 8' */
  page_range: string;
  /** Finishing service request */
  binding: BindingType;
}

export interface PrintSettingsValidationErrors {
  paper_size?: string | undefined;
  color_mode?: string | undefined;
  sides?: string | undefined;
  orientation?: string | undefined;
  copies?: string | undefined;
  page_range?: string | undefined;
  binding?: string | undefined;
  _general?: string | undefined;
}

export interface PrintSettingsCalculation {
  /** Total unique pages selected per copy */
  effectivePageCount: number;
  /** Ordered list of 1-indexed pages included */
  resolvedPages: number[];
  /** Estimated physical sheets of paper used */
  estimatedSheetCount: number;
}

export interface PrintSettingsValidationResult {
  isValid: boolean;
  errors: PrintSettingsValidationErrors;
  calculation?: PrintSettingsCalculation | undefined;
}

export interface PaperSizeOption {
  id: PaperSize;
  label: string;
  description: string;
  dimensions: string;
}

export interface ColorModeOption {
  id: ColorMode;
  label: string;
  description: string;
  badge?: string | undefined;
}

export interface SideModeOption {
  id: SideMode;
  label: string;
  description: string;
}

export interface OrientationOption {
  id: Orientation;
  label: string;
  icon: string;
}

export interface BindingOption {
  id: BindingType;
  label: string;
  description: string;
  isFinishingService: boolean;
}
