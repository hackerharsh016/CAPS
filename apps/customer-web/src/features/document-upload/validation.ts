/**
 * Client-side preflight document validation for CAPS Customer Web.
 * Enforces file format constraints, size ceilings, and non-empty checks.
 */

import type {
  SupportedMimeType,
  SupportedExtension,
  UploadValidationError
} from './types';

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 Megabytes

export const SUPPORTED_MIME_TYPES: readonly SupportedMimeType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain'
] as const;

export const SUPPORTED_EXTENSIONS: readonly SupportedExtension[] = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.docx',
  '.pptx',
  '.txt'
] as const;

export const EXTENSION_MIME_MAP: Record<SupportedExtension, SupportedMimeType> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain'
};

/**
 * Formats a raw byte count into a readable string (e.g. 1.5 MB or 450 KB).
 */
export function formatFileSizeBytes(bytes: number): string {
  if (bytes < 0 || isNaN(bytes)) return '0 B';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unit = units[i] || 'B';
  const val = bytes / Math.pow(1024, i);

  return `${val.toFixed(i === 0 ? 0 : 1)} ${unit}`;
}

/**
 * Extracts normalized lowercase file extension including dot (e.g., ".pdf").
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Preflight checks before starting network upload.
 * Catches empty files, oversized files, and unsupported formats immediately on client.
 */
export function validateDocumentPreflight(file: {
  name: string;
  size: number;
  type?: string | undefined;
}): { valid: boolean; error?: UploadValidationError | undefined } {
  if (!file || !file.name) {
    return {
      valid: false,
      error: {
        code: 'EMPTY_FILE',
        message: 'No document file was selected.'
      }
    };
  }

  // 1. Check for empty files (0 bytes)
  if (file.size <= 0) {
    return {
      valid: false,
      error: {
        code: 'EMPTY_FILE',
        message: 'The selected file is empty (0 bytes). Please upload a valid document.'
      }
    };
  }

  // 2. Check for oversized files (> 50MB)
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File exceeds the 50MB size limit (selected: ${formatFileSizeBytes(file.size)}). Please compress the document or choose a smaller file.`
      }
    };
  }

  // 3. Check file extension
  const ext = getFileExtension(file.name) as SupportedExtension;
  const isSupportedExt = SUPPORTED_EXTENSIONS.includes(ext);

  if (!isSupportedExt) {
    return {
      valid: false,
      error: {
        code: 'UNSUPPORTED_TYPE',
        message: `Unsupported file format (${ext || 'no extension'}). CAPS accepts PDF, JPG, PNG, DOCX, PPTX, and TXT files.`
      }
    };
  }

  // 4. Check MIME type if provided by browser
  if (file.type && file.type.trim()) {
    const isSupportedMime = SUPPORTED_MIME_TYPES.includes(file.type as SupportedMimeType);
    // Some browsers report generic octet-stream for docx/pptx or no type
    const isGenericMime = file.type === 'application/octet-stream' || file.type === '';

    if (!isSupportedMime && !isGenericMime) {
      // If extension is valid but MIME is mismatched (e.g. an .exe renamed to .pdf)
      const expectedMime = EXTENSION_MIME_MAP[ext];
      if (expectedMime && file.type !== expectedMime) {
        return {
          valid: false,
          error: {
            code: 'UNSUPPORTED_TYPE',
            message: `MIME type mismatch (${file.type}). Please verify that the file is not corrupted or misnamed.`
          }
        };
      }
    }
  }

  return { valid: true };
}
