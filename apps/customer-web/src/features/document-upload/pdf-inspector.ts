/**
 * Client-side PDF Inspector for CAPS Customer Web.
 * Parses PDF binary structures to extract page counts, detect password protection,
 * and verify structural integrity without external binary dependencies.
 */

export interface PdfInspectionResult {
  isValidPdf: boolean;
  pageCount: number;
  isPasswordProtected: boolean;
  isCorrupted: boolean;
  errorMessage?: string | undefined;
}

/**
 * Inspects a PDF ArrayBuffer or Uint8Array.
 */
export function inspectPdfBytes(bytes: ArrayBuffer | Uint8Array): PdfInspectionResult {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (uint8.length === 0) {
    return {
      isValidPdf: false,
      pageCount: 0,
      isPasswordProtected: false,
      isCorrupted: true,
      errorMessage: 'File is empty (0 bytes).'
    };
  }

  // 1. Convert initial and trailing chunks to binary string for pattern scanning
  // Scan up to 1MB or full file length
  const scanLength = Math.min(uint8.length, 1024 * 1024);
  let text = '';
  for (let i = 0; i < scanLength; i++) {
    text += String.fromCharCode(uint8[i]!);
  }

  // 2. Validate PDF magic signature (%PDF-)
  const magicIndex = text.indexOf('%PDF-');
  if (magicIndex === -1 || magicIndex > 1024) {
    return {
      isValidPdf: false,
      pageCount: 0,
      isPasswordProtected: false,
      isCorrupted: true,
      errorMessage: 'Invalid PDF: Missing or invalid %PDF header signature.'
    };
  }

  // 3. Detect Password / Encryption dictionary (/Encrypt)
  const isEncrypted = /\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(text);
  if (isEncrypted) {
    return {
      isValidPdf: true,
      pageCount: 0,
      isPasswordProtected: true,
      isCorrupted: false,
      errorMessage:
        'This document is password-protected or encrypted. CAPS cannot print secured files without authorization. Please remove the password and re-upload.'
    };
  }

  // 4. Extract Page Count from /Type /Pages /Count N
  // Matches: /Type /Pages ... /Count 12
  let detectedPageCount = 0;
  const pagesCountRegex = /\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = pagesCountRegex.exec(text)) !== null) {
    const count = parseInt(match[1] || '0', 10);
    if (!isNaN(count) && count > detectedPageCount) {
      detectedPageCount = count;
    }
  }

  // Fallback 1: Count individual leaf /Type /Page (not /Pages)
  if (detectedPageCount === 0) {
    const leafPageMatches = text.match(/\/Type\s*\/Page\b/g);
    if (leafPageMatches && leafPageMatches.length > 0) {
      detectedPageCount = leafPageMatches.length;
    }
  }

  // If still 0 and file has valid structure, default to minimum 1 page
  if (detectedPageCount <= 0) {
    // If the PDF has %%EOF, it's a valid 1-page document with an unusual dictionary layout
    if (text.includes('%%EOF') || uint8.length > 200) {
      detectedPageCount = 1;
    } else {
      return {
        isValidPdf: true,
        pageCount: 0,
        isPasswordProtected: false,
        isCorrupted: true,
        errorMessage: 'Unable to extract pages from corrupted or truncated PDF structure.'
      };
    }
  }

  return {
    isValidPdf: true,
    pageCount: detectedPageCount,
    isPasswordProtected: false,
    isCorrupted: false
  };
}

/**
 * Inspects a File object by reading its ArrayBuffer.
 */
export async function inspectPdfFile(file: File): Promise<PdfInspectionResult> {
  try {
    const buffer = await file.arrayBuffer();
    return inspectPdfBytes(buffer);
  } catch (err) {
    return {
      isValidPdf: false,
      pageCount: 0,
      isPasswordProtected: false,
      isCorrupted: true,
      errorMessage: err instanceof Error ? err.message : 'Failed to read PDF file.'
    };
  }
}
