import { describe, it, expect } from 'vitest';
import {
  ConversionService,
  generatePageThumbnail
} from '../../src/features/document-upload/conversion-service';
import type { UploadedDocumentMetadata } from '../../src/features/document-upload/types';

describe('Document Preview & Conversion Service (P04-M03-F03)', () => {
  const service = new ConversionService();

  const createDummyUploadedDoc = (
    name: string,
    extension: string,
    sizeBytes = 10240
  ): UploadedDocumentMetadata => ({
    id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name,
    sizeBytes,
    mimeType: 'application/octet-stream',
    extension,
    uploadedAt: new Date().toISOString(),
    storagePath: `private/usr-test/doc-test/${name}`
  });

  const createPdfFile = (content: string, name = 'test.pdf'): File => {
    const blob = new Blob([content], { type: 'application/pdf' });
    return new File([blob], name, { type: 'application/pdf' });
  };

  describe('PDF Inspection and Native Preview', () => {
    it('inspects native PDF and determines correct page count without conversion', async () => {
      const pdfContent = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Count 4>> endobj
xref
%%EOF`;
      const file = createPdfFile(pdfContent, 'assignment.pdf');
      const doc = createDummyUploadedDoc('assignment.pdf', '.pdf', file.size);

      const preview = await service.getOrStartDocumentPreview(doc, file);

      expect(preview.conversionStatus).toBe('not_required');
      expect(preview.pageCount).toBe(4);
      expect(preview.isPasswordProtected).toBe(false);
      expect(preview.isCorrupted).toBe(false);
      expect(preview.pages.length).toBe(4);
      expect(preview.pages[0]?.pageNumber).toBe(1);
      expect(preview.pages[3]?.pageNumber).toBe(4);
    });

    it('rejects password-protected PDF with conversion failure and security flag', async () => {
      const encryptedPdf = `%PDF-1.7
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Count 10>> endobj
3 0 obj <</Encrypt 4 0 R>> endobj
%%EOF`;
      const file = createPdfFile(encryptedPdf, 'locked_payslip.pdf');
      const doc = createDummyUploadedDoc('locked_payslip.pdf', '.pdf', file.size);

      const preview = await service.getOrStartDocumentPreview(doc, file);

      expect(preview.conversionStatus).toBe('failed');
      expect(preview.isPasswordProtected).toBe(true);
      expect(preview.pageCount).toBe(0);
      expect(preview.conversionError).toContain('Password-protected');
    });

    it('rejects corrupted PDF with clear error', async () => {
      const corruptedFile = createPdfFile('INVALID_BINARY_JUNK', 'broken.pdf');
      const doc = createDummyUploadedDoc('broken.pdf', '.pdf', corruptedFile.size);

      const preview = await service.getOrStartDocumentPreview(doc, corruptedFile);

      expect(preview.conversionStatus).toBe('failed');
      expect(preview.isCorrupted).toBe(true);
      expect(preview.pageCount).toBe(0);
      expect(preview.conversionError).toBeDefined();
    });
  });

  describe('Image and Text Document Conversion', () => {
    it('converts JPG and PNG images to single-page documents', async () => {
      const docJpg = createDummyUploadedDoc('id_card.jpg', '.jpg', 50000);
      const previewJpg = await service.getOrStartDocumentPreview(docJpg);

      expect(previewJpg.conversionStatus).toBe('completed');
      expect(previewJpg.pageCount).toBe(1);
      expect(previewJpg.pages.length).toBe(1);

      const docPng = createDummyUploadedDoc('chart.png', '.png', 40000);
      const previewPng = await service.getOrStartDocumentPreview(docPng);

      expect(previewPng.conversionStatus).toBe('completed');
      expect(previewPng.pageCount).toBe(1);
    });

    it('paginates plain text documents (.txt)', async () => {
      const docTxt = createDummyUploadedDoc('script.txt', '.txt', 8000);
      const previewTxt = await service.getOrStartDocumentPreview(docTxt);

      expect(previewTxt.conversionStatus).toBe('completed');
      expect(previewTxt.pageCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Office Document Conversion (DOCX, PPTX)', () => {
    it('converts valid DOCX and PPTX files asynchronously to PDF', async () => {
      const docx = createDummyUploadedDoc('report.docx', '.docx', 25000);
      const previewDocx = await service.getOrStartDocumentPreview(docx);

      expect(previewDocx.conversionStatus).toBe('completed');
      expect(previewDocx.pageCount).toBe(4);
      expect(previewDocx.pages.length).toBe(4);

      const pptx = createDummyUploadedDoc('presentation.pptx', '.pptx', 60000);
      const previewPptx = await service.getOrStartDocumentPreview(pptx);

      expect(previewPptx.conversionStatus).toBe('completed');
      expect(previewPptx.pageCount).toBe(8);
      expect(previewPptx.pages.length).toBe(8);
    });

    it('surfaces conversion failure for macro-enabled or corrupted Office documents', async () => {
      const macroDoc = createDummyUploadedDoc('macro_infected_form.docx', '.docx', 20000);
      const preview = await service.getOrStartDocumentPreview(macroDoc);

      expect(preview.conversionStatus).toBe('failed');
      expect(preview.pageCount).toBe(0);
      expect(preview.conversionError).toContain('conversion failed');
    });
  });

  describe('Explicit Unsupported Formats Handling', () => {
    it('does not pretend unsupported formats work and explicitly returns conversion failure', async () => {
      const exeDoc = createDummyUploadedDoc('setup.exe', '.exe', 10000);
      const previewExe = await service.getOrStartDocumentPreview(exeDoc);

      expect(previewExe.conversionStatus).toBe('failed');
      expect(previewExe.pageCount).toBe(0);
      expect(previewExe.conversionError).toContain('Unsupported file format (.exe)');

      const zipDoc = createDummyUploadedDoc('archive.zip', '.zip', 50000);
      const previewZip = await service.getOrStartDocumentPreview(zipDoc);

      expect(previewZip.conversionStatus).toBe('failed');
      expect(previewZip.pageCount).toBe(0);
    });
  });

  describe('Page Thumbnail Generator', () => {
    it('generates valid SVG data URI containing page index and title', () => {
      const thumbnail = generatePageThumbnail(2, 5, 'Thesis Draft.pdf');
      expect(thumbnail.startsWith('data:image/svg+xml;utf8,')).toBe(true);
      expect(thumbnail).toContain('Page%202%20of%205');
      expect(thumbnail).toContain('Thesis%20Draft.pdf');
    });
  });
});
