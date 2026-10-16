/**
 * Helper validation and parsing utilities for CAPS.
 */

/**
 * Validates a page range expression.
 * Valid formats:
 * - 'all' (case-insensitive)
 * - Single page numbers: '1', '12'
 * - Comma-separated pages and ranges: '1-5, 8, 11-14'
 * Rejects:
 * - Empty string
 * - Inverted ranges ('5-2')
 * - Zero or negative page numbers ('0', '-1')
 * - Malformed delimiters ('1--5', '1,,2', '1-')
 */
export function isValidPageRange(val: string): boolean {
  if (!val || typeof val !== 'string') {
    return false;
  }

  const trimmed = val.trim();
  if (trimmed.toLowerCase() === 'all') {
    return true;
  }

  const parts = trimmed.split(',').map(p => p.trim());
  if (parts.length === 0) {
    return false;
  }

  for (const part of parts) {
    if (!part) {
      return false; // Trailing or consecutive commas e.g. "1,,2"
    }

    if (part.includes('-')) {
      const rangeParts = part.split('-').map(s => s.trim());
      if (rangeParts.length !== 2) {
        return false;
      }
      const [startStr, endStr] = rangeParts;
      if (!startStr || !endStr) {
        return false;
      }

      if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        return false;
      }

      const start = Number(startStr);
      const end = Number(endStr);

      if (start <= 0 || end <= 0 || start > end) {
        return false;
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
 * Parses a valid page range string into an ordered, deduplicated list of 1-indexed page numbers.
 * @throws Error if the page range is invalid or exceeds totalDocumentPages.
 */
export function parsePageRange(rangeStr: string, totalDocumentPages?: number): number[] {
  if (!isValidPageRange(rangeStr)) {
    throw new Error(`Invalid page range expression: '${rangeStr}'`);
  }

  const trimmed = rangeStr.trim();
  const pages = new Set<number>();

  if (trimmed.toLowerCase() === 'all') {
    if (totalDocumentPages === undefined) {
      throw new Error("Cannot expand 'all' without totalDocumentPages provided");
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

  const result = Array.from(pages).sort((a, b) => a - b);

  if (totalDocumentPages !== undefined) {
    const invalidPages = result.filter(p => p > totalDocumentPages);
    if (invalidPages.length > 0) {
      throw new Error(
        `Page range specifies pages (${invalidPages.join(', ')}) beyond document page count (${totalDocumentPages})`
      );
    }
  }

  return result;
}
