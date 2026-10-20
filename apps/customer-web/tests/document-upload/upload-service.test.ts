import { describe, it, expect } from 'vitest';
import { UploadService } from '../../src/features/document-upload/upload-service';
import type { UploadProgressEvent } from '../../src/features/document-upload/types';

describe('UploadService (P04-M03-F01)', () => {
  const service = new UploadService();

  const createDummyFile = (name: string, size: number, type: string): File => {
    // In Node / Vitest environment, File API is available in Node 20+
    const blob = new Blob(['x'.repeat(Math.min(size, 1024))], { type });
    const file = new File([blob], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  it('successfully uploads valid file and emits progress up to 100%', async () => {
    const file = createDummyFile('sample_assignment.pdf', 10000, 'application/pdf');
    const progressHistory: UploadProgressEvent[] = [];

    const metadata = await service.uploadDocument(file, {
      targetShopId: 'shop-8888-campus-xerox',
      onProgress: p => {
        progressHistory.push(p);
      }
    });

    expect(metadata).toBeDefined();
    expect(metadata.name).toBe('sample_assignment.pdf');
    expect(metadata.extension).toBe('.pdf');
    expect(metadata.storagePath).toContain('shop-8888-campus-xerox');
    expect(metadata.storagePath).toContain('sample_assignment.pdf');

    expect(progressHistory.length).toBeGreaterThan(0);
    expect(progressHistory[0]?.percentage).toBe(0);
    expect(progressHistory[progressHistory.length - 1]?.percentage).toBe(100);
  });

  it('aborts upload in progress when AbortController signal fires', async () => {
    const file = createDummyFile('large_portfolio.pdf', 50000, 'application/pdf');
    const controller = new AbortController();

    // Trigger abort shortly after starting
    setTimeout(() => {
      controller.abort();
    }, 120);

    let caughtError: unknown;
    try {
      await service.uploadDocument(file, {
        signal: controller.signal
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect((caughtError as { code: string }).code).toBe('ABORTED');
  });

  it('rejects immediately if signal is already aborted', async () => {
    const file = createDummyFile('test.pdf', 5000, 'application/pdf');
    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    await expect(service.uploadDocument(file, { signal: controller.signal })).rejects.toMatchObject(
      {
        code: 'ABORTED'
      }
    );
  });

  it('rejects empty file before initiating upload timer', async () => {
    const emptyFile = createDummyFile('empty.pdf', 0, 'application/pdf');

    await expect(service.uploadDocument(emptyFile)).rejects.toMatchObject({
      code: 'EMPTY_FILE'
    });
  });

  it('allows retrying upload after a previous abort without leaking state', async () => {
    const file = createDummyFile('retry_document.pdf', 15000, 'application/pdf');

    // First attempt: cancel
    const controller1 = new AbortController();
    setTimeout(() => controller1.abort(), 60);

    try {
      await service.uploadDocument(file, { signal: controller1.signal });
    } catch {
      // expected abort
    }

    // Second attempt: complete successfully
    const controller2 = new AbortController();
    const metadata = await service.uploadDocument(file, {
      signal: controller2.signal
    });

    expect(metadata.name).toBe('retry_document.pdf');
    expect(metadata.id).toBeDefined();
  });
});
