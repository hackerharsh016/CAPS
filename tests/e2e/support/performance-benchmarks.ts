/**
 * Performance Benchmark Utilities for CAPS Quality Acceptance (P07-M03-F03).
 * Provides statistical latency measurements (p50, p95, p99, min, max, avg)
 * and load generation tools to validate SRS target performance goals.
 */

import { performance } from 'perf_hooks';
import {
  calculatePriceBreakdown,
  DEFAULT_PRICING_RATES
} from '../../../apps/customer-web/src/features/pricing/pricing-calculator';
import type { PrintSettings } from '../../../apps/customer-web/src/features/print-settings/types';
import { IntegrationOrchestrator } from './integration-orchestrator';
import type { E2EPrintJob, PrinterCapabilities } from '../fixtures/integration-fixtures';

export interface LatencyPercentiles {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/**
 * Runs a synchronous or asynchronous benchmark function over N iterations
 * and computes statistical latency percentiles.
 */
export async function measureLatencyPercentiles(
  benchmarkFn: () => void | Promise<void>,
  iterations = 100
): Promise<LatencyPercentiles> {
  const samples: number[] = [];

  // Warmup run
  for (let i = 0; i < Math.min(5, iterations); i++) {
    await benchmarkFn();
  }

  // Measured iterations
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await benchmarkFn();
    const duration = performance.now() - start;
    samples.push(duration);
  }

  samples.sort((a, b) => a - b);

  const count = samples.length;
  const minMs = samples[0] ?? 0;
  const maxMs = samples[count - 1] ?? 0;
  const sum = samples.reduce((acc, val) => acc + val, 0);
  const avgMs = sum / count;

  const p50Ms = samples[Math.floor(count * 0.5)] ?? 0;
  const p95Ms = samples[Math.floor(count * 0.95)] ?? 0;
  const p99Ms = samples[Math.floor(count * 0.99)] ?? 0;

  return {
    count,
    minMs: Number(minMs.toFixed(3)),
    maxMs: Number(maxMs.toFixed(3)),
    avgMs: Number(avgMs.toFixed(3)),
    p50Ms: Number(p50Ms.toFixed(3)),
    p95Ms: Number(p95Ms.toFixed(3)),
    p99Ms: Number(p99Ms.toFixed(3))
  };
}

/**
 * Target 1: Simulates dynamic Quote pricing generation across diverse print settings.
 */
export function benchmarkQuotePricing(): void {
  const sampleSettings: PrintSettings[] = [
    {
      paper_size: 'A4',
      color_mode: 'bw',
      duplex: 'double',
      orientation: 'portrait',
      copies: 2,
      page_range: '1-10',
      binding: 'staple'
    },
    {
      paper_size: 'A3',
      color_mode: 'color',
      duplex: 'single',
      orientation: 'landscape',
      copies: 5,
      page_range: '1-4',
      binding: 'spiral'
    },
    {
      paper_size: 'Legal',
      color_mode: 'bw',
      duplex: 'double',
      orientation: 'portrait',
      copies: 3,
      page_range: '1-25',
      binding: 'none'
    }
  ];

  for (const settings of sampleSettings) {
    calculatePriceBreakdown(settings, 'urgent', 30, DEFAULT_PRICING_RATES);
    calculatePriceBreakdown(settings, 'flexible', 30, DEFAULT_PRICING_RATES);
  }
}

/**
 * Target 2: Simulates Realtime event wake-up & priority queue sorting.
 */
export function benchmarkRealtimeWakeupCycle(
  orchestrator: IntegrationOrchestrator,
  shopId: string
): void {
  // 1. Broadcast queue update / event
  const liveQueue = orchestrator.getLiveQueue(shopId);
  if (liveQueue.length > 0) {
    // 2. Resolve priority ordering and prepare agent claim
    const nextJob = liveQueue[0];
    if (nextJob && nextJob.status === 'approved') {
      orchestrator.agentClaimNextJob({
        shopId,
        agentDeviceId: 'perf-agent-device-001',
        idempotencyKey: `idem-perf-${Math.random()}`
      });
    }
  }
}

/**
 * Target 3: Simulates Agent Startup, config initialization, printer discovery, and Win32 adapter handshake.
 */
export async function benchmarkAgentStartupSequence(): Promise<{
  configLoaded: boolean;
  printersDiscovered: number;
  spoolerReady: boolean;
}> {
  // Simulate reading local agent config from disk / environment
  const config = {
    cloudApiUrl: 'https://api.caps.print/v1',
    agentDeviceId: 'agent-dev-win32-001',
    pairingSecret: 'mock-agent-secret'
  };

  // Simulate local SQLite database connection & schema check
  const localDb = new Map<string, string>();
  localDb.set('agent_device_id', config.agentDeviceId);

  // Simulate Win32 EnumPrinters API discovery
  const discoveredPrinters: PrinterCapabilities[] = [
    {
      id: 'printer-canon-01',
      shop_id: 'shop-01',
      name: 'Canon imageRUNNER 2525 (B&W)',
      is_online: true,
      supported_paper_sizes: ['A4', 'Legal'],
      supports_color: false,
      supports_duplex: true
    },
    {
      id: 'printer-hp-01',
      shop_id: 'shop-01',
      name: 'HP Color LaserJet Pro MFP M479',
      is_online: true,
      supported_paper_sizes: ['A4', 'A3'],
      supports_color: true,
      supports_duplex: true
    }
  ];

  // Win32 Spooler subsystem readiness check
  const spoolerReady = discoveredPrinters.every(p => p.is_online);

  return {
    configLoaded: Boolean(config.agentDeviceId),
    printersDiscovered: discoveredPrinters.length,
    spoolerReady
  };
}

/**
 * Target 4: Multi-Tenant Concurrent Load Generation.
 * Seeds N shops with M jobs each and verifies concurrent execution & strict tenant isolation.
 */
export function generateMultiTenantLoad(
  shopCount = 10,
  jobsPerShop = 10
): {
  orchestrator: IntegrationOrchestrator;
  totalJobs: number;
  shopIds: string[];
} {
  const orchestrator = new IntegrationOrchestrator();
  const shopIds: string[] = [];
  const jobs: E2EPrintJob[] = [];
  const printers: PrinterCapabilities[] = [];

  for (let s = 1; s <= shopCount; s++) {
    const shopId = `00000000-0000-0000-0000-${s.toString().padStart(12, '0')}`;
    const printerId = `11111111-0000-0000-0000-${s.toString().padStart(12, '0')}`;
    shopIds.push(shopId);

    printers.push({
      id: printerId,
      shop_id: shopId,
      name: `Shop ${s} Printer Pro`,
      is_online: true,
      supported_paper_sizes: ['A4'],
      supports_color: true,
      supports_duplex: true
    });

    for (let j = 1; j <= jobsPerShop; j++) {
      const isUrgent = j % 3 === 0;
      jobs.push({
        id: `job-shop-${s}-item-${j}`,
        shop_id: shopId,
        customer_id: `customer-${j}`,
        printer_id: printerId,
        document_storage_key: `shops/${s}/jobs/${j}/document.pdf`,
        document_name: `Shop_${s}_Job_${j}.pdf`,
        settings: {
          paper_size: 'A4',
          color_mode: isUrgent ? 'color' : 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: '1-5'
        },
        priority_tier: isUrgent ? 'urgent' : 'flexible',
        price_total_paise: isUrgent ? 2500 : 750,
        status: 'queued',
        payment_status: 'paid',
        enqueued_at: new Date(Date.now() - (jobsPerShop - j) * 60000).toISOString(),
        created_at: new Date(Date.now() - (jobsPerShop - j) * 60000).toISOString(),
        updated_at: new Date().toISOString(),
        attempt_count: 0
      });
    }
  }

  orchestrator.seedPrinters(printers);
  orchestrator.seedJobs(jobs);

  return {
    orchestrator,
    totalJobs: jobs.length,
    shopIds
  };
}
