'use client';

/**
 * AgentPairingModal Component.
 * Modal for generating ephemeral single-use 8-character pairing codes (CP-XXXXXX)
 * with a live 10-minute countdown timer and copy-to-clipboard functionality.
 * Enforces zero exposure of master API secrets to desktop operators.
 */

import React, { useState, useEffect } from 'react';
import type { GeneratePairingCodeResponse } from '../types';

export interface AgentPairingModalProps {
  isOpen: boolean;
  activeCode: GeneratePairingCodeResponse | null;
  isGenerating: boolean;
  onClose: () => void;
  onGenerateNew: () => Promise<GeneratePairingCodeResponse | null>;
}

export function AgentPairingModal({
  isOpen,
  activeCode,
  isGenerating,
  onClose,
  onGenerateNew
}: AgentPairingModalProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!activeCode) {
      setSecondsRemaining(0);
      return;
    }

    const expiryTime = new Date(activeCode.expiresAt).getTime();

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeCode]);

  if (!isOpen) return null;

  const isExpired = activeCode ? secondsRemaining <= 0 : false;
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const formattedTimer = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  const handleCopy = () => {
    if (!activeCode || isExpired) return;
    void navigator.clipboard.writeText(activeCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pairing-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl" aria-hidden="true">
                💻
              </span>
              <h3 id="pairing-modal-title" className="text-base font-bold text-slate-900">
                Pair Windows Print Agent PC
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Connect a physical Windows computer running the CAPS Desktop Agent to this shop.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
            aria-label="Close pairing dialog"
          >
            ✕
          </button>
        </div>

        {/* Pairing Code Display or Generator Trigger */}
        {!activeCode || isExpired ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center space-y-3">
            <span className="text-3xl block">🔑</span>
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                {isExpired ? 'Pairing Code Expired' : 'Generate Ephemeral Pairing Code'}
              </h4>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Pairing codes are valid for 10 minutes and can only be consumed once by a single Windows agent.
              </p>
            </div>

            <button
              type="button"
              disabled={isGenerating}
              onClick={() => void onGenerateNew()}
              className="inline-flex items-center space-x-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {isGenerating && (
                <svg
                  className="h-3.5 w-3.5 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              <span>{isGenerating ? 'Generating...' : 'Generate New Pairing Code'}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active Code Box */}
            <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/50 p-6 text-center space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Single-Use Enrollment Token
              </span>
              <div className="flex items-center justify-center space-x-3">
                <span className="font-mono text-3xl font-extrabold tracking-widest text-slate-900 select-all">
                  {activeCode.code}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-50"
                  aria-label="Copy pairing code to clipboard"
                >
                  {copied ? '✅ Copied' : '📋 Copy'}
                </button>
              </div>

              {/* Countdown Timer */}
              <div className="flex items-center justify-center space-x-1.5 text-xs font-semibold text-slate-600 pt-1">
                <span>⏱️ Expires in:</span>
                <span className="font-mono font-bold text-emerald-700">{formattedTimer}</span>
              </div>
            </div>

            {/* Operator Setup Instructions */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Setup Instructions on Windows PC:
              </span>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 font-medium pl-1">
                <li>Launch the <strong>CAPS Desktop Print Agent</strong> installer or executable.</li>
                <li>When prompted during first run, enter the code above: <code className="font-bold text-slate-800">{activeCode.code}</code></li>
                <li>The agent will automatically authenticate, discover connected printers, and register securely via Windows DPAPI.</li>
              </ol>
            </div>
          </div>
        )}

        {/* Security Notice */}
        <p className="text-[11px] text-slate-400 italic">
          Security invariant: Pairing uses ephemeral tokens. Supabase master service role keys and database passwords are never exposed to local PC operators.
        </p>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
