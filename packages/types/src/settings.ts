/**
 * User-side print configuration domain types for CAPS.
 * Supports both canonical duplex ('simplex' | 'duplex_long' | 'duplex_short')
 * and legacy sides ('single' | 'double') with bidirectional normalization.
 */

export type PaperSize = 'A4' | 'A3' | 'Legal';

export type ColorMode = 'bw' | 'color';

export type SideMode = 'single' | 'double';

export type DuplexMode = 'simplex' | 'duplex_long' | 'duplex_short';

export type Orientation = 'portrait' | 'landscape';

export type BindingType = 'none' | 'spiral' | 'staple' | 'lamination';

export interface PrintSettings {
  /** Paper dimensions target */
  paper_size: PaperSize;
  /** Color reproduction mode */
  color_mode: ColorMode;
  /** Single or double-sided printing (legacy sides format) */
  sides?: SideMode;
  /** Canonical duplex mode per OpenAPI and backend print contracts */
  duplex?: DuplexMode;
  /** Page orientation */
  orientation: Orientation;
  /** Copy count between 1 and 100 inclusive */
  copies: number;
  /** Page range specification: 'all' or comma/dash separated numbers, e.g. '1-5, 8' */
  page_range: string;
  /** Finishing service request */
  binding: BindingType;
}

export interface HarmonizedPrintSettings {
  paper_size: PaperSize;
  color_mode: ColorMode;
  sides: SideMode;
  duplex: DuplexMode;
  orientation: Orientation;
  copies: number;
  page_range: string;
  binding: BindingType;
}

/**
 * Normalizes SideMode or any string representation to canonical DuplexMode.
 */
export function sidesToDuplex(
  sides: SideMode | DuplexMode | string | undefined | null
): DuplexMode {
  if (!sides || sides === 'single' || sides === 'simplex') {
    return 'simplex';
  }
  if (sides === 'double' || sides === 'duplex_long') {
    return 'duplex_long';
  }
  if (sides === 'duplex_short') {
    return 'duplex_short';
  }
  return 'simplex';
}

/**
 * Normalizes DuplexMode or any string representation to legacy SideMode.
 */
export function duplexToSides(duplex: DuplexMode | SideMode | string | undefined | null): SideMode {
  if (!duplex || duplex === 'simplex' || duplex === 'single') {
    return 'single';
  }
  if (duplex === 'duplex_long' || duplex === 'duplex_short' || duplex === 'double') {
    return 'double';
  }
  return 'single';
}

/**
 * Bidirectional normalization for print settings:
 * Ensures both canonical `duplex` and legacy `sides` are present and consistent.
 * `duplex` is configured as a non-enumerable property so that strict validators
 * (such as packages/validation PrintSettingsSchema.strict()) accept the object without
 * 'unrecognized_keys: ["duplex"]' errors, while direct property access (`settings.duplex`)
 * and normalization still provide canonical duplex mode.
 */
export function normalizePrintSettings<T extends Partial<PrintSettings>>(
  settings: T
): T & HarmonizedPrintSettings {
  const sides = settings.sides ? duplexToSides(settings.sides) : duplexToSides(settings.duplex);
  const duplex = settings.duplex ? sidesToDuplex(settings.duplex) : sidesToDuplex(settings.sides);

  const result = {
    ...settings,
    paper_size: settings.paper_size ?? 'A4',
    color_mode: settings.color_mode ?? 'bw',
    sides,
    orientation: settings.orientation ?? 'portrait',
    copies: settings.copies ?? 1,
    page_range: settings.page_range ?? 'all',
    binding: settings.binding ?? 'none'
  };

  Object.defineProperty(result, 'duplex', {
    value: duplex,
    enumerable: false,
    writable: true,
    configurable: true
  });

  return result as T & HarmonizedPrintSettings;
}

/**
 * Creates a harmonized print settings object with both sides and duplex.
 */
export function createHarmonizedPrintSettings(
  input: Partial<PrintSettings> = {}
): HarmonizedPrintSettings {
  return normalizePrintSettings(input);
}

/**
 * Strips unrecognized extra properties for schemas that use strict validation
 * (such as packages/validation PrintSettingsSchema.strict()).
 */
export function toValidationPrintSettings(settings: Partial<PrintSettings>): {
  paper_size: PaperSize;
  color_mode: ColorMode;
  sides: SideMode;
  orientation: Orientation;
  copies: number;
  page_range: string;
  binding: BindingType;
} {
  const sides = duplexToSides(settings.sides ?? settings.duplex);
  return {
    paper_size: settings.paper_size ?? 'A4',
    color_mode: settings.color_mode ?? 'bw',
    sides,
    orientation: settings.orientation ?? 'portrait',
    copies: settings.copies ?? 1,
    page_range: settings.page_range ?? 'all',
    binding: settings.binding ?? 'none'
  };
}
