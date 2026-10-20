/**
 * Security Sandbox & Threat Mitigations for CAPS Document Ingestion.
 *
 * Implements:
 * 1. Magic bytes binary signature verification (prevents MIME spoofing).
 * 2. Zip bomb / decompression bomb protection (compression ratio and size limits).
 * 3. XXE (XML External Entity) & Billion Laughs attack mitigation.
 * 4. Dangerous macro / executable code rejection (VBA projects, binary scripts).
 * 5. Execution resource timeouts to prevent CPU starvation.
 */

import {
  MAX_DECOMPRESSED_RATIO,
  MAX_DECOMPRESSED_BYTES,
  DEFAULT_CONVERSION_TIMEOUT_MS
} from './documents.types.js';

export class SecuritySandboxError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'SecuritySandboxError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Validates magic byte signatures against declared MIME types.
 */
export function validateMagicBytes(buffer: Buffer, declaredMime: string): void {
  if (buffer.length < 4) {
    throw new SecuritySandboxError(400, 'CORRUPT_FILE', 'File buffer too short for binary signature verification.');
  }

  // 1. PDF: %PDF- (0x25 0x50 0x44 0x46)
  if (declaredMime === 'application/pdf') {
    const isPdf = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (!isPdf) {
      throw new SecuritySandboxError(400, 'MAGIC_BYTE_MISMATCH', 'File magic bytes do not match declared application/pdf format.');
    }
    return;
  }

  // 2. PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (declaredMime === 'image/png') {
    const isPng =
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (!isPng) {
      throw new SecuritySandboxError(400, 'MAGIC_BYTE_MISMATCH', 'File magic bytes do not match declared image/png format.');
    }
    return;
  }

  // 3. JPEG: 0xFF 0xD8 0xFF
  if (declaredMime === 'image/jpeg') {
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!isJpeg) {
      throw new SecuritySandboxError(400, 'MAGIC_BYTE_MISMATCH', 'File magic bytes do not match declared image/jpeg format.');
    }
    return;
  }

  // 4. OOXML (DOCX, PPTX): Standard PKZip Header 0x50 0x4B 0x03 0x04 (PK\x03\x04)
  const isOoxmlMime =
    declaredMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    declaredMime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  if (isOoxmlMime) {
    const isZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;
    if (!isZip) {
      throw new SecuritySandboxError(400, 'MAGIC_BYTE_MISMATCH', `File magic bytes do not match declared OOXML archive format (${declaredMime}).`);
    }
    return;
  }

  // 5. Legacy Microsoft Office (DOC, PPT): OLE2 Compound Document (0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1)
  const isLegacyOfficeMime =
    declaredMime === 'application/msword' ||
    declaredMime === 'application/vnd.ms-powerpoint';

  if (isLegacyOfficeMime) {
    const isOle2 =
      buffer.length >= 8 &&
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0 &&
      buffer[4] === 0xa1 &&
      buffer[5] === 0xb1 &&
      buffer[6] === 0x1a &&
      buffer[7] === 0xe1;

    // Also accept PKZip if user saved docx/pptx with legacy extension
    const isZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;

    if (!isOle2 && !isZip) {
      throw new SecuritySandboxError(400, 'MAGIC_BYTE_MISMATCH', `File magic bytes do not match declared legacy office format (${declaredMime}).`);
    }
    return;
  }

  throw new SecuritySandboxError(400, 'UNSUPPORTED_MIME', `Unsupported MIME type '${declaredMime}'.`);
}

/**
 * Inspects ZIP header metadata to detect zip bombs, extreme compression ratios,
 * embedded malicious macros, and nested archives.
 */
export function inspectZipSafety(buffer: Buffer): void {
  let offset = 0;
  let totalUncompressed = 0;
  let fileCount = 0;

  // Scan local file headers: signature 0x04034b50 (PK\x03\x04)
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break; // Reached end of local file records or central directory
    }

    fileCount += 1;
    if (fileCount > 5000) {
      throw new SecuritySandboxError(422, 'ZIP_BOMB_DETECTED', 'Archive contains too many file entries (possible zip bomb).');
    }

    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    // Compression ratio check
    if (compressedSize > 0) {
      const ratio = uncompressedSize / compressedSize;
      if (ratio > MAX_DECOMPRESSED_RATIO) {
        throw new SecuritySandboxError(
          422,
          'DECOMPRESSION_BOMB_DETECTED',
          `Archive entry compression ratio (${ratio.toFixed(1)}:1) exceeds maximum allowed safety threshold (${MAX_DECOMPRESSED_RATIO}:1).`
        );
      }
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_DECOMPRESSED_BYTES) {
      throw new SecuritySandboxError(
        422,
        'DECOMPRESSION_SIZE_EXCEEDED',
        `Uncompressed content exceeds maximum allowed memory limit of ${MAX_DECOMPRESSED_BYTES / 1024 / 1024} MB.`
      );
    }

    // Inspect file name for dangerous contents
    const fileNameStart = offset + 30;
    if (fileNameStart + fileNameLength <= buffer.length) {
      const entryName = buffer.subarray(fileNameStart, fileNameStart + fileNameLength).toString('utf8');

      // 1. VBA Macro projects
      if (
        entryName.toLowerCase().includes('vbaproject.bin') ||
        entryName.toLowerCase().includes('vba') ||
        entryName.toLowerCase().endsWith('.vbs') ||
        entryName.toLowerCase().endsWith('.exe') ||
        entryName.toLowerCase().endsWith('.bat')
      ) {
        throw new SecuritySandboxError(
          422,
          'DANGEROUS_CONTENT',
          `Document contains forbidden executable macros or script objects (${entryName}).`
        );
      }

      // 2. Nested zip archives
      if (
        entryName.toLowerCase().endsWith('.zip') ||
        entryName.toLowerCase().endsWith('.tar') ||
        entryName.toLowerCase().endsWith('.gz')
      ) {
        throw new SecuritySandboxError(
          422,
          'NESTED_ARCHIVE_DETECTED',
          `Nested archive detected (${entryName}); archives-in-archives are forbidden for print processing.`
        );
      }
    }

    // Move to next header
    offset += 30 + fileNameLength + extraFieldLength + compressedSize;
  }
}

/**
 * Scans content buffer for XML External Entity (XXE) vectors and entity expansions.
 */
export function inspectXmlSafety(buffer: Buffer): void {
  const preview = buffer.subarray(0, Math.min(buffer.length, 50000)).toString('latin1');

  if (
    preview.includes('<!ENTITY') ||
    preview.includes('SYSTEM "') ||
    preview.includes("SYSTEM '") ||
    preview.includes('PUBLIC "') ||
    (preview.includes('<!DOCTYPE') && preview.includes('&'))
  ) {
    throw new SecuritySandboxError(
      422,
      'XXE_ATTACK_DETECTED',
      'XML external entity (XXE) declarations or entity expansions are forbidden.'
    );
  }
}

/**
 * Wraps an async conversion task with a strict CPU/time limit.
 */
export async function withSandboxTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number = DEFAULT_CONVERSION_TIMEOUT_MS
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new SecuritySandboxError(
          408,
          'CONVERSION_TIMEOUT',
          `Document conversion exceeded allocated time limit of ${timeoutMs}ms.`
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
