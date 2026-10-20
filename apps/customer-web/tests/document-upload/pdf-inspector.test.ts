import { describe, it, expect } from 'vitest';
import { inspectPdfBytes } from '../../src/features/document-upload/pdf-inspector';

describe('PDF Inspector (P04-M03-F03)', () => {
  const encoder = new TextEncoder();

  it('accurately extracts page count from standard PDF with /Count', () => {
    const pdfSource = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 5>> endobj
3 0 obj <</Type /Page /Parent 2 0 R>> endobj
xref
trailer <</Root 1 0 R>>
%%EOF`;

    const bytes = encoder.encode(pdfSource);
    const result = inspectPdfBytes(bytes);

    expect(result.isValidPdf).toBe(true);
    expect(result.pageCount).toBe(5);
    expect(result.isPasswordProtected).toBe(false);
    expect(result.isCorrupted).toBe(false);
  });

  it('detects page count by counting individual leaf /Type /Page objects', () => {
    const pdfSource = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Page /Parent 1 0 R>> endobj
3 0 obj <</Type /Page /Parent 1 0 R>> endobj
xref
%%EOF`;

    const bytes = encoder.encode(pdfSource);
    const result = inspectPdfBytes(bytes);

    expect(result.isValidPdf).toBe(true);
    expect(result.pageCount).toBe(2);
    expect(result.isPasswordProtected).toBe(false);
  });

  it('detects password protection and encryption dictionary (/Encrypt)', () => {
    const encryptedPdf = `%PDF-1.7
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Count 10>> endobj
3 0 obj <</Encrypt 4 0 R>> endobj
4 0 obj <</Filter /Standard /V 2 /R 3 /P -4>> endobj
%%EOF`;

    const bytes = encoder.encode(encryptedPdf);
    const result = inspectPdfBytes(bytes);

    expect(result.isValidPdf).toBe(true);
    expect(result.isPasswordProtected).toBe(true);
    expect(result.pageCount).toBe(0);
    expect(result.errorMessage).toContain('password-protected');
  });

  it('flags corrupted file lacking valid %PDF header', () => {
    const corruptedBytes = encoder.encode('THIS IS NOT A VALID PDF FILE AT ALL');
    const result = inspectPdfBytes(corruptedBytes);

    expect(result.isValidPdf).toBe(false);
    expect(result.isCorrupted).toBe(true);
    expect(result.pageCount).toBe(0);
    expect(result.errorMessage).toContain('Missing or invalid %PDF header');
  });

  it('handles empty 0-byte buffer safely', () => {
    const emptyBytes = new Uint8Array(0);
    const result = inspectPdfBytes(emptyBytes);

    expect(result.isValidPdf).toBe(false);
    expect(result.isCorrupted).toBe(true);
    expect(result.pageCount).toBe(0);
  });
});
