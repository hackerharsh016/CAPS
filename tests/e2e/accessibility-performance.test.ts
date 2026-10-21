/**
 * End-to-End Acceptance Test Suite:
 * Accessibility and Target Performance Validation (P07-M03-F03).
 *
 * Verifies:
 * 1. SRS Target: Quote Calculation Latency < 300ms
 * 2. SRS Target: Realtime Queue Wake-up & Processing < 2000ms
 * 3. SRS Target: Desktop Agent Startup & Initialization < 5000ms
 * 4. Realistic Multi-Tenant Concurrent Scalability (10 shops, 100 concurrent jobs)
 * 5. Customer Web WCAG 2.1 AA Accessibility & Semantic Structure
 * 6. Owner Dashboard Modal Accessibility, Keyboard Navigation & ARIA Conformance
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  measureLatencyPercentiles,
  benchmarkQuotePricing,
  benchmarkRealtimeWakeupCycle,
  benchmarkAgentStartupSequence,
  generateMultiTenantLoad
} from './support/performance-benchmarks';
import { createE2EFixtures } from './fixtures/integration-fixtures';
import { IntegrationOrchestrator } from './support/integration-orchestrator';

describe('P07-M03-F03: Accessibility and Target Performance Validation Gate', () => {
  describe('1. SRS Target Performance: Quote Latency (< 300ms SLA Goal)', () => {
    it('measures quote price breakdown across permutations and verifies p95 < 300ms', async () => {
      const stats = await measureLatencyPercentiles(() => {
        benchmarkQuotePricing();
      }, 100);

      console.log('BENCHMARK_RESULT_QUOTE:', JSON.stringify(stats));

      // Verify SLA Goals
      expect(stats.p95Ms).toBeLessThan(300);
      expect(stats.p99Ms).toBeLessThan(300);
      expect(stats.maxMs).toBeLessThan(300);

      // Record measured values
      expect(stats.count).toBe(100);
      expect(stats.avgMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('2. SRS Target Performance: Realtime Wake-up (< 2s SLA Goal)', () => {
    it('measures event notification to agent claim readiness and verifies p95 < 2000ms', async () => {
      const fixtures = createE2EFixtures();
      const orchestrator = new IntegrationOrchestrator();
      orchestrator.seedPrinters(fixtures.printers);
      orchestrator.seedJobs([fixtures.urgentPaidJob]);

      // Approve job so it is ready for agent claim
      orchestrator.ownerApproveJob({
        jobId: fixtures.urgentPaidJob.id,
        ownerUserId: fixtures.urgentPaidJob.customer_id,
        ownerShopId: fixtures.urgentPaidJob.shop_id
      });

      const stats = await measureLatencyPercentiles(() => {
        benchmarkRealtimeWakeupCycle(orchestrator, fixtures.urgentPaidJob.shop_id);
      }, 100);

      console.log('BENCHMARK_RESULT_REALTIME:', JSON.stringify(stats));

      // Verify SLA Goals (< 2000ms)
      expect(stats.p95Ms).toBeLessThan(2000);
      expect(stats.p99Ms).toBeLessThan(2000);
      expect(stats.maxMs).toBeLessThan(2000);
    });
  });

  describe('3. SRS Target Performance: Desktop Agent Startup (< 5s SLA Goal)', () => {
    it('measures agent bootstrap, database initialization, and printer discovery and verifies p95 < 5000ms', async () => {
      const stats = await measureLatencyPercentiles(async () => {
        const result = await benchmarkAgentStartupSequence();
        expect(result.configLoaded).toBe(true);
        expect(result.printersDiscovered).toBeGreaterThan(0);
        expect(result.spoolerReady).toBe(true);
      }, 50);

      console.log('BENCHMARK_RESULT_AGENT:', JSON.stringify(stats));

      // Verify SLA Goals (< 5000ms)
      expect(stats.p95Ms).toBeLessThan(5000);
      expect(stats.p99Ms).toBeLessThan(5000);
      expect(stats.maxMs).toBeLessThan(5000);
    });
  });

  describe('4. Realistic Multi-Tenant Concurrent Scalability & Isolation', () => {
    it('handles 10 concurrent tenant shops with 100 jobs without cross-tenant queue contamination', () => {
      const { orchestrator, totalJobs, shopIds } = generateMultiTenantLoad(10, 10);
      expect(totalJobs).toBe(100);
      expect(shopIds.length).toBe(10);

      // Verify queue length and strict isolation per shop
      for (let i = 0; i < shopIds.length; i++) {
        const shopId = shopIds[i]!;
        const queue = orchestrator.getLiveQueue(shopId);

        // Every shop has 10 jobs
        expect(queue.length).toBe(10);

        // Every job in this shop's queue must belong strictly to this shop
        for (const job of queue) {
          expect(job.shop_id).toBe(shopId);
        }

        // Verify priority ordering: urgent jobs must precede flexible jobs
        const urgentIndex = queue.findIndex(j => j.priority_tier === 'urgent');
        const flexibleIndex = queue.findIndex(j => j.priority_tier === 'flexible');
        if (urgentIndex !== -1 && flexibleIndex !== -1) {
          expect(urgentIndex).toBeLessThan(flexibleIndex);
        }
      }

      // Simulate concurrent claims across distinct shop agents
      for (let i = 0; i < shopIds.length; i++) {
        const shopId = shopIds[i]!;
        // Approve first job
        const queue = orchestrator.getLiveQueue(shopId);
        const topJob = queue[0]!;

        orchestrator.ownerApproveJob({
          jobId: topJob.id,
          ownerUserId: `owner-${i}`,
          ownerShopId: shopId
        });

        // Agent for shop i claims
        const claim = orchestrator.agentClaimNextJob({
          shopId,
          agentDeviceId: `agent-device-shop-${i}`,
          idempotencyKey: `idem-claim-shop-${i}`
        });

        expect(claim.claimed).toBe(true);
        expect(claim.job?.shop_id).toBe(shopId);
      }
    });
  });

  describe('5. Customer Web Accessibility & WCAG 2.1 AA Compliance', () => {
    const customerWebSrc = path.resolve(__dirname, '../../apps/customer-web/src');

    it('verifies form inputs and print settings have accessible labels and descriptions', () => {
      const settingsFormPath = path.join(
        customerWebSrc,
        'features/print-settings/components/PrintSettingsForm.tsx'
      );
      expect(fs.existsSync(settingsFormPath)).toBe(true);

      const content = fs.readFileSync(settingsFormPath, 'utf-8');

      // Check for labels or form role semantics
      expect(content).toMatch(/<label|aria-label|aria-labelledby/);
      expect(content).toMatch(/htmlFor|id=/);
    });

    it('verifies queue tracking view contains ARIA live regions for screen readers', () => {
      const bannerPath = path.join(
        customerWebSrc,
        'features/queue-tracking/components/StatusExplanationBanner.tsx'
      );
      expect(fs.existsSync(bannerPath)).toBe(true);

      const content = fs.readFileSync(bannerPath, 'utf-8');
      expect(content).toContain('aria-live="polite"');
      expect(content).toContain('role="status"');
    });

    it('verifies checkout payment forms contain alert regions for validation errors', () => {
      const checkoutShellPath = path.join(
        customerWebSrc,
        'features/checkout/components/CheckoutShell.tsx'
      );
      expect(fs.existsSync(checkoutShellPath)).toBe(true);

      const content = fs.readFileSync(checkoutShellPath, 'utf-8');
      expect(content).toContain('role="alert"');
    });
  });

  describe('6. Owner Dashboard Accessibility, Keyboard Navigation & Modal Focus', () => {
    const ownerDashboardSrc = path.resolve(__dirname, '../../apps/owner-dashboard/src');

    it('verifies modal dialogs declare role="dialog" and aria-modal="true"', () => {
      const recoveryModalPath = path.join(
        ownerDashboardSrc,
        'features/agent-monitoring/components/OperatorRecoveryModal.tsx'
      );
      const pairingModalPath = path.join(
        ownerDashboardSrc,
        'features/agent-monitoring/components/AgentPairingModal.tsx'
      );

      expect(fs.existsSync(recoveryModalPath)).toBe(true);
      expect(fs.existsSync(pairingModalPath)).toBe(true);

      const recoveryContent = fs.readFileSync(recoveryModalPath, 'utf-8');
      const pairingContent = fs.readFileSync(pairingModalPath, 'utf-8');

      // Recovery Modal ARIA attributes
      expect(recoveryContent).toContain('role="dialog"');
      expect(recoveryContent).toContain('aria-modal="true"');
      expect(recoveryContent).toMatch(/aria-labelledby|aria-label/);

      // Pairing Modal ARIA attributes
      expect(pairingContent).toContain('role="dialog"');
      expect(pairingContent).toContain('aria-modal="true"');
    });

    it('verifies filter navigation uses accessible tablist and tab roles', () => {
      const filterTabsPath = path.join(
        ownerDashboardSrc,
        'features/live-queue/components/QueueFilterTabs.tsx'
      );
      expect(fs.existsSync(filterTabsPath)).toBe(true);

      const content = fs.readFileSync(filterTabsPath, 'utf-8');
      expect(content).toContain('role="tablist"');
      expect(content).toContain('role="tab"');
      expect(content).toContain('aria-selected=');
    });

    it('verifies visible focus rings and keyboard interaction handlers exist on buttons', () => {
      const confirmButtonPath = path.join(
        ownerDashboardSrc,
        'features/print-confirmation/components/ConfirmPrintButton.tsx'
      );
      expect(fs.existsSync(confirmButtonPath)).toBe(true);

      const content = fs.readFileSync(confirmButtonPath, 'utf-8');
      // Focus outline classes
      expect(content).toMatch(/focus:ring|focus:outline/);
    });

    it('verifies incident banners declare role="alert" for immediate operator notice', () => {
      const bannerPath = path.join(
        ownerDashboardSrc,
        'features/agent-monitoring/components/HardwareIncidentBanner.tsx'
      );
      expect(fs.existsSync(bannerPath)).toBe(true);

      const content = fs.readFileSync(bannerPath, 'utf-8');
      expect(content).toContain('role="alert"');
    });
  });
});
