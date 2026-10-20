'use client';

/**
 * Privacy Notice component for CAPS Document Upload.
 * Explicitly surfaces private storage guarantees, short-lived signed tokens,
 * zero public URLs, and automatic document destruction policies.
 */

import React from 'react';

export function PrivacyNotice() {
  return (
    <div
      role="region"
      aria-label="Document privacy and security guarantee"
      className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 text-indigo-950 space-y-3"
    >
      <div className="flex items-center space-x-2">
        <span className="text-xl">🔒</span>
        <h3 className="text-sm font-bold">CAPS Zero-Leak Privacy Guarantee</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-indigo-900/90">
        <div className="rounded-xl bg-white/70 p-3 border border-indigo-100">
          <p className="font-semibold text-indigo-950">No Public URLs</p>
          <p className="mt-1">
            Files are stored in private cloud buckets with short-lived signed tokens (15-min
            expiry).
          </p>
        </div>

        <div className="rounded-xl bg-white/70 p-3 border border-indigo-100">
          <p className="font-semibold text-indigo-950">Tenant Scoped</p>
          <p className="mt-1">
            Access is strictly tied to your authenticated customer ID; cross-user reads are blocked.
          </p>
        </div>

        <div className="rounded-xl bg-white/70 p-3 border border-indigo-100">
          <p className="font-semibold text-indigo-950">Auto-Purge</p>
          <p className="mt-1">
            Documents are automatically destroyed from local agent spoolers immediately after
            printing.
          </p>
        </div>
      </div>
    </div>
  );
}
