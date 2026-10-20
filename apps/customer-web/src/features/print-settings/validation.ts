/**
 * Client-side validation logic and mathematical calculations for Print Settings (P04-M04-F01).
 * Strictly enforces limits (1-100 copies, page range grammar, option enums)
 * and calculates effective pages and physical sheet count.
 */

import type {
  PrintSettings,
  PaperSize,
  ColorMode,
  SideMode,
  Orientation,
  BindingType,
  PrintSettingsValidationResult,
  PrintSettingsValidationErrors,
  PrintSettingsCalculation
} from './types';

export const VALID_PAPER_SIZES: readonly PaperSize[] = ['A4', 'A3', 'Legal'] as const;
export const VALID_COLOR_MODES: readonly ColorMode[] = ['bw', 'color'] as const;
export const VALID_SIDE_MODES: readonly SideMode[] = ['single', 'double'] as const;
export const VALID_ORIENTATIONS: readonly Orientation[] = ['portrait', 'landscape'] as const;
export const VALID_BINDINGS: readonly BindingType[] = [
  'none',
  'spiral',
  'staple',
  'lamination'
] as const;

export const MIN_COPIES = 1;
export const MAX_COPIES = 100;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper_size: 'A4',
  color_mode: 'bw',
  sides: 'single',
  orientation: 'portrait',
  copies: 1,
  page_range: 'all',
  binding: 'none'
};

/**
 * Validates a page range expression according to CAPS specification.
 * Valid syntax:
 * - 'all' (case-insensitive)
 * - Single integers: '1', '12'
 * - Comma-delimited pages and ranges: '1-5, 8, 11-14'
 *
 * Rejects:
 * - Empty string or whitespace
 * - Inverted ranges ('5-2')
 * - Zero or negative numbers ('0', '-1')
 * - Consecutive/trailing delimiters ('1,,2', '1-', '1--5', ',1')
 */
export function isValidPageRange(val: string): boolean {
  if (!val || typeof val !== 'string') {
    return false;
  }

  const trimmed = val.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (trimmed.toLowerCase() === 'all') {
    return true;
  }

  // Reject leading or trailing commas
  if (trimmed.startsWith(',') || trimmed.endsWith(',')) {
    return false;
  }

  const parts = trimmed.split(',').map(p => p.trim());
  if (parts.length === 0) {
    return false;
  }

  for (const part of parts) {
    if (!part) {
      return false; // Consecutive commas e.g. "1,,2"
    }

    if (part.includes('-')) {
      const rangeParts = part.split('-').map(s => s.trim());
      if (rangeParts.length !== 2) {
        return false; // Multiple hyphens e.g. "1-2-3" or "1--5"
      }
      const [startStr, endStr] = rangeParts;
      if (!startStr || !endStr) {
        return false; // Empty range boundary e.g. "1-" or "-5"
      }

      if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        return false;
      }

      const start = Number(startStr);
      const end = Number(endStr);

      if (start <= 0 || end <= 0 || start > end) {
        return false; // Zero, negative, or inverted range e.g. "5-2"
      }
    } else {
      if (!/^\d+$/.test(part)) {
        return false;
      }
      const page = Number(part);
      if (page <= 0) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Parses a valid page range expression into an ordered, deduplicated array of 1-indexed page numbers.
 * @throws Error if the range format is invalid or references pages beyond totalDocumentPages.
 */
export function parsePageRange(rangeStr: string, totalDocumentPages?: number): number[] {
  if (!isValidPageRange(rangeStr)) {
    throw new Error(`Invalid page range expression: '${rangeStr}'`);
  }

  const trimmed = rangeStr.trim();
  const pages = new Set<number>();

  if (trimmed.toLowerCase() === 'all') {
    if (totalDocumentPages === undefined || totalDocumentPages <= 0) {
      // Default to at least page 1 when total pages is unknown
      return [1];
    }
    for (let i = 1; i <= totalDocumentPages; i++) {
      pages.add(i);
    }
    return Array.from(pages);
  }

  const parts = trimmed.split(',').map(p => p.trim());
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-').map(s => s.trim());
      const start = Number(startStr);
      const end = Number(endStr);
      for (let i = start; i <= end; i++) {
        pages.add(i);
      }
    } else {
      pages.add(Number(part));
    }
  }

  const sortedPages = Array.from(pages).sort((a, b) => a - b);

  if (totalDocumentPages !== undefined && totalDocumentPages > 0) {
    const invalidPages = sortedPages.filter(p => p > totalDocumentPages);
    if (invalidPages.length > 0) {
      throw new Error(
        `Page range references page ${invalidPages.join(', ')} which exceeds document total of ${totalDocumentPages} ${totalDocumentPages === 1 ? 'page' : 'pages'}`
      );
    }
  }

  return sortedPages;
}

/**
 * Calculates estimated physical sheets of paper used.
 * - Single-sided: 1 sheet per page per copy
 * - Double-sided: 1 sheet per 2 pages per copy (rounded up)
 */
export function calculateEstimatedSheets(
  effectivePageCount: number,
  sides: SideMode,
  copies: number
): number {
  if (effectivePageCount <= 0 || copies <= 0) {
    return 0;
  }
  const sheetsPerCopy = sides === 'double' ? Math.ceil(effectivePageCount / 2) : effectivePageCount;
  return sheetsPerCopy * copies;
}

/**
 * Validates copy count (integer between 1 and 100).
 */
export function validateCopies(copies: unknown): { isValid: boolean; error?: string | undefined } {
  if (copies === undefined || copies === null || copies === '') {
    return { isValid: false, error: 'Copies count is required' };
  }

  const num = typeof copies === 'number' ? copies : Number(copies);
  if (isNaN(num)) {
    return { isValid: false, error: 'Copies must be an integer' };
  }

  if (!Number.isInteger(num)) {
    return { isValid: false, error: 'Copies must be an integer' };
  }

  if (num < MIN_COPIES) {
    return { isValid: false, error: `Copies must be at least ${MIN_COPIES}` };
  }

  if (num > MAX_COPIES) {
    return { isValid: false, error: `Copies cannot exceed ${MAX_COPIES}` };
  }

  return { isValid: true };
}

/**
 * Validates a complete PrintSettings object.
 */
export function validatePrintSettings(
  settings: Partial<PrintSettings>,
  totalDocumentPages?: number
): PrintSettingsValidationResult {
  const errors: PrintSettingsValidationErrors = {};

  // 1. Paper size
  if (!settings.paper_size || !VALID_PAPER_SIZES.includes(settings.paper_size as PaperSize)) {
    errors.paper_size = "Paper size must be one of 'A4', 'A3', or 'Legal'";
  }

  // 2. Color mode
  if (!settings.color_mode || !VALID_COLOR_MODES.includes(settings.color_mode as ColorMode)) {
    errors.color_mode = "Color mode must be either 'bw' or 'color'";
  }

  // 3. Sides / Duplex
  if (!settings.sides || !VALID_SIDE_MODES.includes(settings.sides as SideMode)) {
    errors.sides = "Sides mode must be either 'single' or 'double'";
  }

  // 4. Orientation
  if (!settings.orientation || !VALID_ORIENTATIONS.includes(settings.orientation as Orientation)) {
    errors.orientation = "Orientation must be either 'portrait' or 'landscape'";
  }

  // 5. Copies
  const copiesVal = validateCopies(settings.copies);
  if (!copiesVal.isValid && copiesVal.error) {
    errors.copies = copiesVal.error;
  }

  // 6. Page range
  if (
    !settings.page_range ||
    typeof settings.page_range !== 'string' ||
    !settings.page_range.trim()
  ) {
    errors.page_range = 'Page range is required';
  } else if (!isValidPageRange(settings.page_range)) {
    errors.page_range = 'Invalid page range format. Must be "all" or expressions like "1-5, 8"';
  } else if (totalDocumentPages !== undefined && totalDocumentPages > 0) {
    try {
      parsePageRange(settings.page_range, totalDocumentPages);
    } catch (err: unknown) {
      errors.page_range = err instanceof Error ? err.message : 'Invalid page range';
    }
  }

  // 7. Binding
  if (!settings.binding || !VALID_BINDINGS.includes(settings.binding as BindingType)) {
    errors.binding = "Binding must be 'none', 'spiral', 'staple', or 'lamination'";
  }

  const isValid = Object.keys(errors).length === 0;

  let calculation: PrintSettingsCalculation | undefined;
  if (isValid) {
    try {
      const resolvedPages = parsePageRange(settings.page_range!, totalDocumentPages);
      const effectivePageCount = resolvedPages.length;
      const estimatedSheetCount = calculateEstimatedSheets(
        effectivePageCount,
        settings.sides!,
        settings.copies!
      );
      calculation = {
        effectivePageCount,
        resolvedPages,
        estimatedSheetCount
      };
    } catch {
      // In case calculation fails unexpectedly
    }
  }

  return {
    isValid,
    errors,
    calculation
  };
}
