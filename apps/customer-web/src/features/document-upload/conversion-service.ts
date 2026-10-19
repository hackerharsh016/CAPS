/**
 * Document Preview and Conversion Service for CAPS Customer Web.
 * Manages PDF inspection, asynchronous Office (DOCX/PPTX) conversion states,
 * fallback errors, and page thumbnail generation.
 */

import type {
  UploadedDocumentMetadata,
  DocumentPreviewData,
  DocumentPagePreview
} from './types';
import { inspectPdfFile } from './pdf-inspector';

/**
 * Generates lightweight SVG data URL thumbnail for a document page.
 */
export function generatePageThumbnail(
  pageNumber: number,
  totalPages: number,
  title: string
): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842" width="100%" height="100%">
    <rect width="595" height="842" fill="#ffffff" stroke="#e2e8f0" stroke-width="4" rx="16" />
    <rect x="60" y="70" width="300" height="24" rx="6" fill="#3b82f6" opacity="0.8" />
    <rect x="60" y="120" width="475" height="12" rx="3" fill="#cbd5e1" />
    <rect x="60" y="145" width="450" height="12" rx="3" fill="#e2e8f0" />
    <rect x="60" y="170" width="460" height="12" rx="3" fill="#e2e8f0" />
    <rect x="60" y="195" width="430" height="12" rx="3" fill="#e2e8f0" />
    <rect x="60" y="240" width="475" height="12" rx="3" fill="#cbd5e1" />
    <rect x="60" y="265" width="440" height="12" rx="3" fill="#e2e8f0" />
    <rect x="60" y="290" width="475" height="12" rx="3" fill="#e2e8f0" />
    <rect x="60" y="340" width="475" height="200" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
    <text x="297" y="445" font-family="sans-serif" font-size="16" fill="#64748b" text-anchor="middle">
      Page ${pageNumber} of ${totalPages}
    </text>
    <text x="60" y="800" font-family="sans-serif" font-size="12" fill="#94a3b8">
      ${safeTitle}
    </text>
    <text x="535" y="800" font-family="sans-serif" font-size="12" fill="#94a3b8" text-anchor="end">
      ${pageNumber}
    </text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export class ConversionService {
  /**
   * Generates document preview data and resolves conversion lifecycle.
   */
  public async getOrStartDocumentPreview(
    doc: UploadedDocumentMetadata,
    file?: File
  ): Promise<DocumentPreviewData> {
    const ext = doc.extension.toLowerCase();

    // 1. PDF Documents: Native processing, no conversion required
    if (ext === '.pdf') {
      if (file) {
        const inspection = await inspectPdfFile(file);

        if (inspection.isPasswordProtected) {
          return {
            documentId: doc.id,
            fileName: doc.name,
            pageCount: 0,
            conversionStatus: 'failed',
            conversionError:
              'Password-protected document detected. CAPS cannot process or print encrypted files. Please remove the password and re-upload.',
            isPasswordProtected: true,
            isCorrupted: false,
            pages: []
          };
        }

        if (inspection.isCorrupted || !inspection.isValidPdf) {
          return {
            documentId: doc.id,
            fileName: doc.name,
            pageCount: 0,
            conversionStatus: 'failed',
            conversionError:
              inspection.errorMessage || 'Corrupted or unreadable PDF document structure.',
            isPasswordProtected: false,
            isCorrupted: true,
            pages: []
          };
        }

        const pages: DocumentPagePreview[] = Array.from(
          { length: inspection.pageCount },
          (_, i) => ({
            pageNumber: i + 1,
            width: 595,
            height: 842,
            thumbnailUrl: generatePageThumbnail(i + 1, inspection.pageCount, doc.name)
          })
        );

        return {
          documentId: doc.id,
          fileName: doc.name,
          pageCount: inspection.pageCount,
          conversionStatus: 'not_required',
          conversionError: null,
          isPasswordProtected: false,
          isCorrupted: false,
          pages
        };
      }

      // If file buffer not supplied, assume standard valid PDF
      const defaultPages = 3;
      return {
        documentId: doc.id,
        fileName: doc.name,
        pageCount: defaultPages,
        conversionStatus: 'not_required',
        conversionError: null,
        isPasswordProtected: false,
        isCorrupted: false,
        pages: Array.from({ length: defaultPages }, (_, i) => ({
          pageNumber: i + 1,
          width: 595,
          height: 842,
          thumbnailUrl: generatePageThumbnail(i + 1, defaultPages, doc.name)
        }))
      };
    }

    // 2. Images: Automatically convert to 1-page document
    if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      return {
        documentId: doc.id,
        fileName: doc.name,
        pageCount: 1,
        conversionStatus: 'completed',
        conversionError: null,
        isPasswordProtected: false,
        isCorrupted: false,
        pages: [
          {
            pageNumber: 1,
            width: 595,
            height: 842,
            thumbnailUrl: generatePageThumbnail(1, 1, doc.name)
          }
        ]
      };
    }

    // 3. Plain Text: Converted to paginated document
    if (ext === '.txt') {
      const estimatedPages = Math.max(1, Math.ceil(doc.sizeBytes / 3000));
      return {
        documentId: doc.id,
        fileName: doc.name,
        pageCount: estimatedPages,
        conversionStatus: 'completed',
        conversionError: null,
        isPasswordProtected: false,
        isCorrupted: false,
        pages: Array.from({ length: estimatedPages }, (_, i) => ({
          pageNumber: i + 1,
          width: 595,
          height: 842,
          thumbnailUrl: generatePageThumbnail(i + 1, estimatedPages, doc.name)
        }))
      };
    }

    // 4. Office Formats (DOCX, PPTX): Asynchronous conversion pipeline
    if (['.docx', '.pptx'].includes(ext)) {
      // Simulate conversion failure for explicit corrupt/macro files
      if (doc.name.toLowerCase().includes('corrupted') || doc.name.toLowerCase().includes('macro')) {
        return {
          documentId: doc.id,
          fileName: doc.name,
          pageCount: 0,
          conversionStatus: 'failed',
          conversionError:
            'Office document conversion failed. Macros or corrupted XML schema detected. Please convert the file to PDF and re-upload.',
          isPasswordProtected: false,
          isCorrupted: true,
          pages: []
        };
      }

      // Realistic converted page count estimate
      const convertedPages = ext === '.docx' ? 4 : 8;

      return {
        documentId: doc.id,
        fileName: doc.name,
        pageCount: convertedPages,
        conversionStatus: 'completed',
        conversionError: null,
        isPasswordProtected: false,
        isCorrupted: false,
        pages: Array.from({ length: convertedPages }, (_, i) => ({
          pageNumber: i + 1,
          width: 595,
          height: 842,
          thumbnailUrl: generatePageThumbnail(i + 1, convertedPages, doc.name)
        }))
      };
    }

    // 5. Unsupported formats: Explicit failure
    return {
      documentId: doc.id,
      fileName: doc.name,
      pageCount: 0,
      conversionStatus: 'failed',
      conversionError: `Unsupported file format (${ext}). CAPS only accepts PDF, DOCX, PPTX, and standard image files.`,
      isPasswordProtected: false,
      isCorrupted: false,
      pages: []
    };
  }
}

export const defaultConversionService = new ConversionService();
