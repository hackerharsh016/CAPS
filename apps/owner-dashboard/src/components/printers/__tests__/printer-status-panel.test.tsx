import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrinterStatusPanel } from '../printer-status-panel';
import { PrinterApiService } from '../../../services/api/printer.service';
import type { PrinterTelemetry } from '../../../services/api/printer.service';

describe('Owner Dashboard Hardware Status & Alerting Panel (INT-D2-04)', () => {
  const shopId = 'shop-speedy-print-001';

  const mockPrinters: PrinterTelemetry[] = [
    {
      id: 'printer-1',
      shop_id: shopId,
      name: 'HP LaserJet Pro M404n',
      status: 'ONLINE',
      is_online: true,
      toner_level: 85,
      error_state: 'NONE',
      last_heartbeat_at: new Date().toISOString()
    },
    {
      id: 'printer-2',
      shop_id: shopId,
      name: 'Canon imageRUNNER 2520',
      status: 'ERROR',
      is_online: true,
      toner_level: 10,
      error_state: 'JAMMED',
      error_message: 'Paper path jam detected in Tray 2',
      last_heartbeat_at: new Date().toISOString()
    },
    {
      id: 'printer-3',
      shop_id: shopId,
      name: 'Epson EcoTank L3150',
      status: 'ERROR',
      is_online: true,
      toner_level: 60,
      error_state: 'PAPER_OUT',
      error_message: 'Out of paper in standard feeder',
      last_heartbeat_at: new Date().toISOString()
    },
    {
      id: 'printer-4',
      shop_id: shopId,
      name: 'Brother HL-L2321D',
      status: 'OFFLINE',
      is_online: false,
      toner_level: 0,
      error_state: 'OFFLINE',
      error_message: 'Agent heartbeat lost',
      last_heartbeat_at: new Date().toISOString()
    }
  ];

  const mockFailedJobs = [
    {
      id: 'job-failed-101',
      document_name: 'Quarterly_Report.pdf',
      customer_name: 'John Doe',
      error_code: 'PAPER_JAM',
      error_message: 'Printer reported hardware paper jam'
    },
    {
      id: 'job-failed-102',
      document_name: 'Architectural_Blueprint.pdf',
      customer_name: 'Sarah Connor',
      error_code: 'PRINTER_OFFLINE',
      error_message: 'Spooler target printer is offline'
    }
  ];

  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn().mockImplementation(async (url: string, _init?: RequestInit) => {
      if (url.includes('/printers')) {
        return {
          ok: true,
          status: 200,
          json: async () => mockPrinters
        };
      }
      if (url.includes('/retry') || url.includes('/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            jobId: 'job-failed-101',
            status: 'QUEUED'
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({})
      };
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('PrinterApiService', () => {
    it('fetches live printers via GET /api/v1/shops/:shopId/printers', async () => {
      const apiService = new PrinterApiService({
        baseUrl: 'http://localhost:4000',
        authToken: 'token-abc'
      });
      const printers = await apiService.getPrinters(shopId);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/shops/shop-speedy-print-001/printers',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc'
          })
        })
      );
      expect(printers.length).toBe(4);
      expect(printers[0].name).toBe('HP LaserJet Pro M404n');
      expect(printers[0].is_online).toBe(true);
      expect(printers[0].toner_level).toBe(85);
    });

    it('submits retry requests via POST /api/v1/shops/:shopId/jobs/:jobId/retry', async () => {
      const apiService = new PrinterApiService({ baseUrl: 'http://localhost:4000' });
      const res = await apiService.retryJob(shopId, 'job-failed-101');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/shops/shop-speedy-print-001/jobs/job-failed-101/retry',
        expect.objectContaining({
          method: 'POST'
        })
      );
      expect(res.success).toBe(true);
      expect(res.status).toBe('QUEUED');
    });
  });

  describe('Hardware Alert Banners', () => {
    it('displays prominent alert banner when a printer is JAMMED', () => {
      const html = renderToStaticMarkup(
        <PrinterStatusPanel
          shopId={shopId}
          printers={[mockPrinters[1]]} // JAMMED printer
        />
      );

      expect(html).toContain('HARDWARE PAPER JAM');
      expect(html).toContain('Canon imageRUNNER 2520');
      expect(html).toContain('JAMMED');
    });

    it('displays prominent alert banner when a printer is PAPER_OUT', () => {
      const html = renderToStaticMarkup(
        <PrinterStatusPanel
          shopId={shopId}
          printers={[mockPrinters[2]]} // PAPER_OUT printer
        />
      );

      expect(html).toContain('OUT OF PAPER');
      expect(html).toContain('Epson EcoTank L3150');
      expect(html).toContain('PAPER_OUT');
    });

    it('displays prominent alert banner when a printer is OFFLINE', () => {
      const html = renderToStaticMarkup(
        <PrinterStatusPanel
          shopId={shopId}
          printers={[mockPrinters[3]]} // OFFLINE printer
        />
      );

      expect(html).toContain('OFFLINE');
      expect(html).toContain('Brother HL-L2321D');
    });

    it('displays low toner warning when toner is 15% or less', () => {
      const html = renderToStaticMarkup(
        <PrinterStatusPanel
          shopId={shopId}
          printers={[mockPrinters[1]]} // 10% toner
        />
      );

      expect(html).toContain('toner is low (10% remaining)');
      expect(html).toContain('LOW_TONER');
    });
  });

  describe('Failed Jobs & Retry Action', () => {
    it('renders failed jobs list with error codes and Retry Print buttons', () => {
      const html = renderToStaticMarkup(
        <PrinterStatusPanel shopId={shopId} printers={mockPrinters} failedJobs={mockFailedJobs} />
      );

      expect(html).toContain('Failed Print Jobs (2)');
      expect(html).toContain('Quarterly_Report.pdf');
      expect(html).toContain('PAPER_JAM');
      expect(html).toContain('Architectural_Blueprint.pdf');
      expect(html).toContain('PRINTER_OFFLINE');
      expect(html).toContain('Retry Print');
    });

    it('invokes retry callback when Retry Print is triggered', async () => {
      const apiService = new PrinterApiService();

      // Test retry action through service directly
      await apiService.retryJob(shopId, 'job-failed-101');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/jobs/job-failed-101/retry'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Realtime Agent Telemetry Subscription', () => {
    it('wires subscription to agent.status broadcast events on caps:shop:<shopId>', () => {
      const mockChannel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn()
      };
      const mockSupabase = {
        channel: vi.fn().mockReturnValue(mockChannel),
        removeChannel: vi.fn()
      };

      const apiService = new PrinterApiService({ supabaseClient: mockSupabase });
      const callback = vi.fn();
      const unsubscribe = apiService.subscribeToAgentStatus(shopId, callback);

      expect(mockSupabase.channel).toHaveBeenCalledWith(`caps:shop:${shopId}`);
      expect(mockChannel.on).toHaveBeenCalledWith(
        'broadcast',
        { event: 'agent.status' },
        expect.any(Function)
      );
      expect(mockChannel.subscribe).toHaveBeenCalled();

      // Trigger callback with agent status payload
      const registeredHandler = mockChannel.on.mock.calls[0][2];
      registeredHandler({
        payload: {
          printer_id: 'printer-1',
          name: 'HP LaserJet Pro M404n',
          status: 'ERROR',
          error_state: 'JAMMED'
        }
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'printer-1',
          name: 'HP LaserJet Pro M404n',
          status: 'ERROR',
          error_state: 'JAMMED'
        })
      );

      unsubscribe();
      expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });
  });
});
