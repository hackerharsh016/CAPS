/**
 * High-Fidelity Fake Windows Print Spooler for Integration Testing (P05-M05-F02).
 * Simulates Win32 OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter,
 * EndPagePrinter, EndDocPrinter, and GetJob telemetry without requiring physical hardware.
 */

export interface SpoolerJobRecord {
  spoolerJobId: number;
  printerName: string;
  documentTitle: string;
  leaseToken: string;
  idempotencyKey: string;
  status:
    | 'SUBMITTED'
    | 'SPOOLING'
    | 'PRINTING'
    | 'PRINTED'
    | 'ERROR_OUT_OF_PAPER'
    | 'ERROR_PAPER_JAM'
    | 'DELETED';
  pagesTotal: number;
  pagesPrinted: number;
  submittedAt: number;
  completedAt?: number | undefined;
}

export class FakeWindowsSpooler {
  private currentSpoolerJobId = 1000;
  private readonly jobs = new Map<number, SpoolerJobRecord>();
  private readonly idempotencyIndex = new Map<string, SpoolerJobRecord>();

  // Injected fault states
  public simulatePaperOutPrinters = new Set<string>();
  public simulatePaperJamPrinters = new Set<string>();
  public offlinePrinters = new Set<string>();

  /**
   * Submits a print job to the Windows Spooler.
   * Guarantees idempotency: replayed submissions return the cached spooler record.
   */
  submitJob(params: {
    printerName: string;
    documentTitle: string;
    leaseToken: string;
    idempotencyKey: string;
    pages: number;
  }): { success: boolean; spoolerJobId?: number; errorCode?: string; errorMessage?: string } {
    // 1. Check if printer is offline
    if (this.offlinePrinters.has(params.printerName)) {
      return {
        success: false,
        errorCode: 'PRINTER_OFFLINE',
        errorMessage: `Printer '${params.printerName}' is offline or disconnected.`
      };
    }

    // 2. Idempotency check: prevent duplicate physical print output
    const cached = this.idempotencyIndex.get(params.idempotencyKey);
    if (cached) {
      return {
        success: true,
        spoolerJobId: cached.spoolerJobId
      };
    }

    // 3. Check for immediate paper-out condition
    if (this.simulatePaperOutPrinters.has(params.printerName)) {
      return {
        success: false,
        errorCode: 'PRINTER_PAPER_OUT',
        errorMessage: `Printer '${params.printerName}' has an empty paper tray.`
      };
    }

    // 4. Check for paper jam condition
    if (this.simulatePaperJamPrinters.has(params.printerName)) {
      return {
        success: false,
        errorCode: 'ERROR_PAPER_JAM',
        errorMessage: `Printer '${params.printerName}' reported a paper jam.`
      };
    }

    // 4. Create new Windows spooler job record
    this.currentSpoolerJobId += 1;
    const spoolerJobId = this.currentSpoolerJobId;

    const record: SpoolerJobRecord = {
      spoolerJobId,
      printerName: params.printerName,
      documentTitle: params.documentTitle,
      leaseToken: params.leaseToken,
      idempotencyKey: params.idempotencyKey,
      status: this.simulatePaperJamPrinters.has(params.printerName)
        ? 'ERROR_PAPER_JAM'
        : 'SUBMITTED',
      pagesTotal: params.pages,
      pagesPrinted: 0,
      submittedAt: Date.now()
    };

    this.jobs.set(spoolerJobId, record);
    this.idempotencyIndex.set(params.idempotencyKey, record);

    return {
      success: true,
      spoolerJobId
    };
  }

  /**
   * Simulates OS spooler monitoring telemetry (GetJob Win32 API).
   */
  getJobStatus(spoolerJobId: number): SpoolerJobRecord | null {
    return this.jobs.get(spoolerJobId) ?? null;
  }

  /**
   * Simulates physical completion of the print job on hardware.
   */
  completePhysicalPrint(spoolerJobId: number): boolean {
    const job = this.jobs.get(spoolerJobId);
    if (!job) return false;
    if (job.status === 'ERROR_PAPER_JAM' || job.status === 'ERROR_OUT_OF_PAPER') {
      return false;
    }
    job.status = 'PRINTED';
    job.pagesPrinted = job.pagesTotal;
    job.completedAt = Date.now();
    return true;
  }

  /**
   * Clears spooler state for clean test isolation.
   */
  reset() {
    this.jobs.clear();
    this.idempotencyIndex.clear();
    this.simulatePaperOutPrinters.clear();
    this.simulatePaperJamPrinters.clear();
    this.offlinePrinters.clear();
  }
}
