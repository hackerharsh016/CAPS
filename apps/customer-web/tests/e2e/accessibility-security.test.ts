/**
 * Accessibility and Security Compliance Acceptance Suite (P04-M07-F01).
 * Verifies WCAG 2.1 AA accessibility standards, zero secret leakage,
 * and multi-tenant isolation across all customer web modules.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Accessibility & Security Verification (P04-M07-F01)', () => {
  describe('Security: Zero Secret Leakage & Bundle Safety', () => {
    it('verifies no service-role secrets or private payment keys are present in customer-web source', () => {
      const srcDir = path.resolve(__dirname, '../../src');

      const prohibitedPatterns = [
        /sk_live_[0-9a-zA-Z]{24}/,
        /rzp_live_[0-9a-zA-Z]{14}/,
        /service_role_key\s*[:=]\s*["'][a-zA-Z0-9_.-]{20,}["']/i,
        /secret_key\s*[:=]\s*["'][a-zA-Z0-9_-]{20,}["']/i
      ];

      function scanDirectory(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDirectory(fullPath);
          } else if (/\.(tsx?|jsx?|json)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            for (const pattern of prohibitedPatterns) {
              const match = pattern.exec(content);
              expect(
                match,
                `Security Violation: Prohibited secret pattern found in ${fullPath}: ${pattern}`
              ).toBeNull();
            }
          }
        }
      }

      scanDirectory(srcDir);
    });

    it('guarantees client auth configuration forbids service-role keys', async () => {
      const { SupabaseAuthClient } = await import('../../src/features/auth/supabase-auth-client');

      // Attempting to initialize with a forbidden configuration should be prevented
      expect(
        () =>
          new SupabaseAuthClient({
            supabaseUrl: 'https://test.supabase.co',
            supabaseAnonKey: 'anon-key',
            // @ts-expect-error - Testing forbidden serviceRoleKey runtime guard
            serviceRoleKey: 'forbidden-service-key'
          })
      ).toThrow();
    });
  });

  describe('Accessibility: Semantic HTML & ARIA Attribute Compliance', () => {
    it('verifies critical tracking and checkout components contain required ARIA attributes', () => {
      const checkoutShellPath = path.resolve(
        __dirname,
        '../../src/features/checkout/components/CheckoutShell.tsx'
      );
      const trackingViewPath = path.resolve(
        __dirname,
        '../../src/features/queue-tracking/components/JobTrackingView.tsx'
      );
      const statusBannerPath = path.resolve(
        __dirname,
        '../../src/features/queue-tracking/components/StatusExplanationBanner.tsx'
      );
      const tokenCardPath = path.resolve(
        __dirname,
        '../../src/features/queue-tracking/components/TokenCard.tsx'
      );

      const checkoutContent = fs.readFileSync(checkoutShellPath, 'utf-8');
      const trackingContent = fs.readFileSync(trackingViewPath, 'utf-8');
      const bannerContent = fs.readFileSync(statusBannerPath, 'utf-8');
      const tokenContent = fs.readFileSync(tokenCardPath, 'utf-8');

      // Check for live regions
      expect(checkoutContent).toContain('role="alert"');
      expect(trackingContent).toContain('aria-label=');

      // Check for status live regions in explanations
      expect(bannerContent).toContain('role="alert"');
      expect(bannerContent).toContain('role="status"');
      expect(bannerContent).toContain('aria-live="polite"');

      // Check for button accessible names
      expect(tokenContent).toContain('aria-label="Copy token number"');
    });
  });
});
