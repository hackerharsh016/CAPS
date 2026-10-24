/**
 * Virtual Printer Environment for Automated Hardware Emulation (CAPS Phase 07 / Milestone 04).
 *
 * Emulates a physical Windows printer and the Win32 Print Spooler subsystem:
 * - OpenPrinterW / ClosePrinter
 * - StartDocPrinterW / EndDocPrinter
 * - StartPagePrinter / EndPagePrinter
 * - WritePrinter (rasterized payload consumption)
 * - Virtual Paper Tray (with sheet consumption, paper-out, and refill)
 * - Virtual Paper Path (with paper-jam simulation and clear)
 * - Physical Output Delivery: Writes executed print artifacts to disk for validation
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface VirtualPrinterCapabilities {
  printer_id: string;
  name: string;
  role: 'bw' | 'color';
  paper_sizes: string[];
  color_modes: ('bw' | 'color')[];
  duplex_supported: boolean;
  max_copies: number;
}

export interface VirtualSpoolerJobRecord {
  spoolerJobId: number;
  printerName: string;
  documentTitle: string;
  leaseToken: string;
  idempotencyKey: string;
  status: 'SUBMITTED' | 'SPOOLING' | 'PRINTING' | 'EXECUTED' | 'ERROR_OUT_OF_PAPER' | 'ERROR_PAPER_JAM' | 'FAILED';
  pagesTotal: number;
  pagesPrinted: number;
  totalBytesWritten: number;
  copies: number;
  duplex: boolean;
  submittedAt: number;
  executedAt?: number | undefined;
  outputArtifactPath?: string | undefined;
  outputChecksum?: string | undefined;
  error?: string | undefined;
}

export class VirtualPrinterEnvironment {
  public readonly capabilities: VirtualPrinterCapabilities;
  public readonly outputDirectory: string;

  private currentSpoolerJobId = 2000;
  private handleCounter = 100;
  private readonly openHandles = new Map<
    number,
    {
      printerName: string;
      jobId: number | null;
      inDoc: boolean;
      inPage: boolean;
      currentPageBytes: Buffer[];
      totalDocBytes: Buffer[];
      pagesPrinted: number;
      totalPages: number;
      copies: number;
      duplex: boolean;
      title: string;
      leaseToken: string;
      idempotencyKey: string;
    }
  >();

  private readonly jobs = new Map<number, VirtualSpoolerJobRecord>();
  private readonly idempotencyMap = new Map<string, VirtualSpoolerJobRecord>();

  // Hardware emulation state
  public isOnline = true;
  public paperTrayCapacity = 250;
  public currentPaperLevel = 250;
  public simulatePaperJamNext = false;
  public totalSheetsConsumed = 0;

  constructor(options: {
    printerName?: string;
    role?: 'bw' | 'color';
    paperTrayCapacity?: number;
    outputDirectory?: string;
  } = {}) {
    const name = options.printerName ?? 'Virtual-HP-LaserJet-Pro-M404';
    const role = options.role ?? 'bw';

    this.capabilities = {
      printer_id: `printer-virt-${Math.random().toString(36).substring(2, 8)}`,
      name,
      role,
      paper_sizes: ['A4', 'A3', 'Legal'],
      color_modes: role === 'color' ? ['bw', 'color'] : ['bw'],
      duplex_supported: true,
      max_copies: 99
    };

    this.paperTrayCapacity = options.paperTrayCapacity ?? 250;
    this.currentPaperLevel = this.paperTrayCapacity;

    this.outputDirectory =
      options.outputDirectory ??
      path.resolve(process.cwd(), 'tests/e2e/.virtual-printer-output');

    if (!fs.existsSync(this.outputDirectory)) {
      fs.mkdirSync(this.outputDirectory, { recursive: true });
    }
  }

  // ============================================================================
  // Win32 Spooler API Emulation
  // ============================================================================

  /**
   * Emulates Win32 OpenPrinterW.
   */
  openPrinter(printerName: string): number {
    if (!this.isOnline) {
      throw new Error(`[PRINTER_OFFLINE] Virtual printer '${printerName}' is offline or disconnected.`);
    }

    if (printerName !== this.capabilities.name) {
      throw new Error(`[PRINTER_NOT_FOUND] Printer '${printerName}' is not installed in the virtual environment.`);
    }

    const handle = ++this.handleCounter;
    this.openHandles.set(handle, {
      printerName,
      jobId: null,
      inDoc: false,
      inPage: false,
      currentPageBytes: [],
      totalDocBytes: [],
      pagesPrinted: 0,
      totalPages: 0,
      copies: 1,
      duplex: false,
      title: '',
      leaseToken: '',
      idempotencyKey: ''
    });

    return handle;
  }

  /**
   * Emulates Win32 StartDocPrinterW.
   */
  startDocPrinter(
    handle: number,
    params: {
      documentTitle: string;
      totalPages: number;
      copies?: number;
      duplex?: boolean;
      leaseToken: string;
      idempotencyKey: string;
    }
  ): number {
    const session = this.openHandles.get(handle);
    if (!session) {
      throw new Error(`[INVALID_HANDLE] Printer handle ${handle} is not open.`);
    }

    // Idempotency check: Return existing spooler job if duplicate submission
    const existing = this.idempotencyMap.get(params.idempotencyKey);
    if (existing) {
      session.jobId = existing.spoolerJobId;
      return existing.spoolerJobId;
    }

    const spoolerJobId = ++this.currentSpoolerJobId;
    session.jobId = spoolerJobId;
    session.inDoc = true;
    session.title = params.documentTitle;
    session.totalPages = params.totalPages;
    session.copies = params.copies ?? 1;
    session.duplex = params.duplex ?? false;
    session.leaseToken = params.leaseToken;
    session.idempotencyKey = params.idempotencyKey;

    const record: VirtualSpoolerJobRecord = {
      spoolerJobId,
      printerName: session.printerName,
      documentTitle: params.documentTitle,
      leaseToken: params.leaseToken,
      idempotencyKey: params.idempotencyKey,
      status: 'SPOOLING',
      pagesTotal: params.totalPages * session.copies,
      pagesPrinted: 0,
      totalBytesWritten: 0,
      copies: session.copies,
      duplex: session.duplex,
      submittedAt: Date.now()
    };

    this.jobs.set(spoolerJobId, record);
    this.idempotencyMap.set(params.idempotencyKey, record);

    return spoolerJobId;
  }

  /**
   * Emulates Win32 StartPagePrinter.
   */
  startPagePrinter(handle: number): void {
    const session = this.openHandles.get(handle);
    if (!session || !session.inDoc) {
      throw new Error(`[SPOOLER_SEQUENCE_ERROR] Cannot start page without active document.`);
    }

    // 1. Hardware check: Paper Jam
    if (this.simulatePaperJamNext) {
      this.simulatePaperJamNext = false;
      const job = this.jobs.get(session.jobId!);
      if (job) job.status = 'ERROR_PAPER_JAM';
      throw new Error(`[ERROR_PAPER_JAM] Virtual printer paper path sensor reported paper jam.`);
    }

    // 2. Hardware check: Paper Tray Out
    if (this.currentPaperLevel <= 0) {
      const job = this.jobs.get(session.jobId!);
      if (job) job.status = 'ERROR_OUT_OF_PAPER';
      throw new Error(`[ERROR_OUT_OF_PAPER] Virtual printer paper tray is empty.`);
    }

    session.inPage = true;
    session.currentPageBytes = [];

    const job = this.jobs.get(session.jobId!);
    if (job) {
      job.status = 'PRINTING';
    }
  }

  /**
   * Emulates Win32 WritePrinter.
   */
  writePrinter(handle: number, data: Buffer | Uint8Array): number {
    const session = this.openHandles.get(handle);
    if (!session || !session.inPage) {
      throw new Error(`[SPOOLER_SEQUENCE_ERROR] Cannot write printer raster before startPagePrinter.`);
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    session.currentPageBytes.push(buf);
    session.totalDocBytes.push(buf);

    const job = this.jobs.get(session.jobId!);
    if (job) {
      job.totalBytesWritten += buf.length;
    }

    return buf.length;
  }

  /**
   * Emulates Win32 EndPagePrinter.
   */
  endPagePrinter(handle: number): void {
    const session = this.openHandles.get(handle);
    if (!session || !session.inPage) {
      throw new Error(`[SPOOLER_SEQUENCE_ERROR] Cannot end page when not in page.`);
    }

    session.inPage = false;
    session.pagesPrinted++;

    // Consume physical sheet (duplex consumes 1 sheet for 2 pages)
    if (!session.duplex || session.pagesPrinted % 2 !== 0) {
      this.currentPaperLevel--;
      this.totalSheetsConsumed++;
    }

    const job = this.jobs.get(session.jobId!);
    if (job) {
      job.pagesPrinted = session.pagesPrinted;
    }
  }

  /**
   * Emulates Win32 EndDocPrinter and produces physical output artifact on disk.
   */
  endDocPrinter(handle: number): VirtualSpoolerJobRecord {
    const session = this.openHandles.get(handle);
    if (!session || !session.inDoc) {
      throw new Error(`[SPOOLER_SEQUENCE_ERROR] Cannot end doc when not in doc.`);
    }

    session.inDoc = false;
    const jobId = session.jobId!;
    const job = this.jobs.get(jobId)!;

    // Concatenate all raster payload chunks
    const fullPayload = Buffer.concat(session.totalDocBytes);
    const checksum = createHash('sha256').update(fullPayload).digest('hex');

    // Generate physical executed artifact on disk
    const artifactFilename = `executed_spool_${jobId}_${Date.now()}.bin`;
    const artifactPath = path.join(this.outputDirectory, artifactFilename);

    const artifactManifest = {
      spooler_job_id: jobId,
      printer_name: session.printerName,
      document_title: session.title,
      lease_token: session.leaseToken,
      pages_executed: session.pagesPrinted,
      total_pages_ordered: session.totalPages,
      copies: session.copies,
      duplex: session.duplex,
      total_bytes_rasterized: fullPayload.length,
      payload_sha256: checksum,
      hardware_status: 'PHYSICALLY_PRINTED_AND_EJECTED',
      executed_at: new Date().toISOString()
    };

    fs.writeFileSync(artifactPath, JSON.stringify(artifactManifest, null, 2), 'utf-8');

    job.status = 'EXECUTED';
    job.executedAt = Date.now();
    job.outputArtifactPath = artifactPath;
    job.outputChecksum = checksum;

    return job;
  }

  /**
   * Emulates Win32 ClosePrinter.
   */
  closePrinter(handle: number): void {
    this.openHandles.delete(handle);
  }

  // ============================================================================
  // Virtual Hardware Management
  // ============================================================================

  refillPaper(sheets: number = 250): void {
    this.currentPaperLevel = Math.min(this.paperTrayCapacity, this.currentPaperLevel + sheets);
  }

  simulateJam(): void {
    this.simulatePaperJamNext = true;
  }

  clearJam(): void {
    this.simulatePaperJamNext = false;
  }

  setPower(online: boolean): void {
    this.isOnline = online;
  }

  getJob(spoolerJobId: number): VirtualSpoolerJobRecord | undefined {
    return this.jobs.get(spoolerJobId);
  }

  getAllExecutedJobs(): VirtualSpoolerJobRecord[] {
    return Array.from(this.jobs.values()).filter(j => j.status === 'EXECUTED');
  }

  /**
   * Verifies that the physical artifact file actually exists on disk.
   */
  verifyOutputArtifact(spoolerJobId: number): {
    exists: boolean;
    manifest?: Record<string, unknown>;
    filePath?: string;
  } {
    const job = this.jobs.get(spoolerJobId);
    if (!job || !job.outputArtifactPath) {
      return { exists: false };
    }

    if (!fs.existsSync(job.outputArtifactPath)) {
      return { exists: false, filePath: job.outputArtifactPath };
    }

    const content = fs.readFileSync(job.outputArtifactPath, 'utf-8');
    const manifest = JSON.parse(content);
    return {
      exists: true,
      filePath: job.outputArtifactPath,
      manifest
    };
  }

  cleanArtifacts(): void {
    if (fs.existsSync(this.outputDirectory)) {
      const files = fs.readdirSync(this.outputDirectory);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(this.outputDirectory, file));
        } catch {
          // ignore
        }
      }
    }
  }
}
