import { describe, it, expect } from 'vitest';
import {
  validateDocumentPreflight,
  formatFileSizeBytes,
  getFileExtension,
  MAX_FILE_SIZE_BYTES
} from '../../src/features/document-upload/validation';

describe('Document Upload - Client Preflight Validation (P04-M03-F01)', () => {
  describe('File Extension Extraction', () => {
    it('extracts lowercased extensions accurately', () => {
      expect(getFileExtension('thesis_final.pdf')).toBe('.pdf');
      expect(getFileExtension('PHOTO_ID.JPEG')).toBe('.jpeg');
      expect(getFileExtension('presentation.PPTX')).toBe('.pptx');
      expect(getFileExtension('archive.tar.gz')).toBe('.gz');
      expect(getFileExtension('no_extension_file')).toBe('');
    });
  });

  describe('Byte Size Formatter', () => {
    it('formats bytes into user-readable units', () => {
      expect(formatFileSizeBytes(0)).toBe('0 B');
      expect(formatFileSizeBytes(512)).toBe('512 B');
      expect(formatFileSizeBytes(1024)).toBe('1.0 KB');
      expect(formatFileSizeBytes(1536)).toBe('1.5 KB');
      expect(formatFileSizeBytes(1048576)).toBe('1.0 MB');
      expect(formatFileSizeBytes(52428800)).toBe('50.0 MB');
    });

    it('handles negative or invalid numbers safely', () => {
      expect(formatFileSizeBytes(-100)).toBe('0 B');
      expect(formatFileSizeBytes(NaN)).toBe('0 B');
    });
  });

  describe('Preflight Validation Rules', () => {
    it('accepts valid PDF document within size limits', () => {
      const res = validateDocumentPreflight({
        name: 'assignment.pdf',
        size: 5 * 1024 * 1024, // 5MB
        type: 'application/pdf'
      });
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('accepts valid images (JPG, PNG)', () => {
      const jpg = validateDocumentPreflight({
        name: 'scan_id.jpg',
        size: 2 * 1024 * 1024,
        type: 'image/jpeg'
      });
      expect(jpg.valid).toBe(true);

      const png = validateDocumentPreflight({
        name: 'diagram.png',
        size: 1 * 1024 * 1024,
        type: 'image/png'
      });
      expect(png.valid).toBe(true);
    });

    it('accepts office documents (DOCX, PPTX) and plain text (TXT)', () => {
      const docx = validateDocumentPreflight({
        name: 'project_report.docx',
        size: 3 * 1024 * 1024,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      expect(docx.valid).toBe(true);

      const pptx = validateDocumentPreflight({
        name: 'slides.pptx',
        size: 8 * 1024 * 1024,
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      });
      expect(pptx.valid).toBe(true);

      const txt = validateDocumentPreflight({
        name: 'readme.txt',
        size: 10 * 1024,
        type: 'text/plain'
      });
      expect(txt.valid).toBe(true);
    });

    it('rejects empty file (0 bytes) with EMPTY_FILE code', () => {
      const res = validateDocumentPreflight({
        name: 'empty.pdf',
        size: 0,
        type: 'application/pdf'
      });
      expect(res.valid).toBe(false);
      expect(res.error?.code).toBe('EMPTY_FILE');
      expect(res.error?.message).toContain('empty (0 bytes)');
    });

    it('rejects oversized file exceeding 50MB limit with FILE_TOO_LARGE code', () => {
      const res = validateDocumentPreflight({
        name: 'huge_cad_drawing.pdf',
        size: MAX_FILE_SIZE_BYTES + 1024,
        type: 'application/pdf'
      });
      expect(res.valid).toBe(false);
      expect(res.error?.code).toBe('FILE_TOO_LARGE');
      expect(res.error?.message).toContain('50MB');
    });

    it('rejects unsupported file formats (.exe, .zip, .mp4) with UNSUPPORTED_TYPE code', () => {
      const exe = validateDocumentPreflight({
        name: 'malware.exe',
        size: 1024,
        type: 'application/x-msdownload'
      });
      expect(exe.valid).toBe(false);
      expect(exe.error?.code).toBe('UNSUPPORTED_TYPE');
      expect(exe.error?.message).toContain('Unsupported file format (.exe)');

      const zip = validateDocumentPreflight({
        name: 'bundle.zip',
        size: 2048,
        type: 'application/zip'
      });
      expect(zip.valid).toBe(false);
      expect(zip.error?.code).toBe('UNSUPPORTED_TYPE');

      const noExt = validateDocumentPreflight({
        name: 'unknown_file',
        size: 5000,
        type: 'text/plain'
      });
      expect(noExt.valid).toBe(false);
      expect(noExt.error?.code).toBe('UNSUPPORTED_TYPE');
    });

    it('rejects MIME type mismatches (e.g. executable renamed to .pdf)', () => {
      const spoofed = validateDocumentPreflight({
        name: 'fake_document.pdf',
        size: 2048,
        type: 'application/x-msdownload' // Invalid MIME for .pdf
      });
      expect(spoofed.valid).toBe(false);
      expect(spoofed.error?.code).toBe('UNSUPPORTED_TYPE');
      expect(spoofed.error?.message).toContain('MIME type mismatch');
    });
  });
});
