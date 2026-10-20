'use client';

/**
 * Capability Warning and Incompatibility Alert Banner (P04-M04-F02).
 * Surfacing explicit hardware restrictions (B&W only, simplex only, A4 only, stale telemetry).
 * Follows strict architectural policy: NEVER silently downgrade customer settings.
 */

import React from 'react';
import type { CapabilityCheckResult, ShopPrinterCapabilities } from '../capabilities-types';

export interface CapabilityWarningBannerProps {
  checkResult?: CapabilityCheckResult | undefined;
  capabilities?: ShopPrinterCapabilities | undefined;
  shopName?: string | undefined;
  onApplySupportedSettings?: (() => void) | undefined;
  onChangeShopUrl?: string | undefined;
}

export function CapabilityWarningBanner({
  checkResult,
  capabilities,
  shopName = 'the selected shop',
  onApplySupportedSettings,
  onChangeShopUrl = '/shops'
}: CapabilityWarningBannerProps) {
  if (!checkResult && !capabilities) return null;

  const incompatibilities = checkResult?.incompatibilities || [];
  const warnings = checkResult?.warnings || [];
  const isOffline = capabilities && capabilities.online_printers_count === 0;
  const isStale = checkResult?.isStale || (capabilities && capabilities.is_stale);

  return (
    <div className="space-y-3" role="region" aria-label="Printer capability alerts">
      {/* 1. Offline / No Hardware Alert (Blocking) */}
      {isOffline && (
        <div
          role="alert"
          className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-xs text-red-900 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-start space-x-3">
            <span className="text-2xl shrink-0" aria-hidden="true">
              🛑
            </span>
            <div>
              <h3 className="font-extrabold text-sm text-red-950">Printers Currently Offline</h3>
              <p className="mt-0.5 text-red-800">
                All printers at {shopName} are currently powered off or reporting hardware errors.
                Orders cannot be queued until a printer reconnects.
              </p>
            </div>
          </div>

          <a
            href={onChangeShopUrl}
            className="shrink-0 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-red-700 transition-colors"
          >
            Choose Another Shop →
          </a>
        </div>
      )}

      {/* 2. Incompatible Selected Settings Alert (Explicit User Choice Required) */}
      {!isOffline && incompatibilities.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-xs text-amber-950 shadow-sm space-y-3"
        >
          <div className="flex items-start space-x-3">
            <span className="text-2xl shrink-0" aria-hidden="true">
              ⚠️
            </span>
            <div className="space-y-1">
              <h3 className="font-extrabold text-sm text-amber-950">
                Settings Incompatible with {shopName}&apos;s Hardware
              </h3>
              <p className="text-amber-900">
                CAPS enforces strict fidelity and will <strong>never silently downgrade</strong>{' '}
                your print quality. The following settings are not supported by this shop:
              </p>
              <ul className="list-disc list-inside space-y-1 pt-1 font-medium text-amber-950">
                {incompatibilities.map((inc, i) => (
                  <li key={i}>{inc.reason}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-amber-200/80">
            {onApplySupportedSettings && (
              <button
                type="button"
                onClick={onApplySupportedSettings}
                className="rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-800 transition-colors"
              >
                Update to Supported Settings
              </button>
            )}

            <a
              href={onChangeShopUrl}
              className="text-xs font-bold text-amber-900 underline hover:no-underline ml-1"
            >
              Find a Compatible Shop
            </a>
          </div>
        </div>
      )}

      {/* 3. Stale Telemetry Notice (Non-blocking) */}
      {!isOffline && isStale && incompatibilities.length === 0 && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900 flex items-center justify-between gap-3"
        >
          <div className="flex items-center space-x-2">
            <span className="text-base" aria-hidden="true">
              ℹ️
            </span>
            <span>
              Printer capabilities for {shopName} were verified over 30 minutes ago. Real-time tray
              paper and toner levels may vary.
            </span>
          </div>

          <span className="text-[11px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded shrink-0">
            Cached telemetry
          </span>
        </div>
      )}

      {/* 4. Additional Warnings */}
      {warnings.length > 0 && !isOffline && (
        <div className="space-y-1">
          {warnings.map((w, idx) => (
            <p key={idx} className="text-[11px] text-slate-500 italic">
              • {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
