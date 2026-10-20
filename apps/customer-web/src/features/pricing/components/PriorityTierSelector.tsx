'use client';

/**
 * Priority Tier Selection Component for CAPS Customer Web (P04-M05-F01).
 * Allows customers to select Flexible (Standard FIFO) or Urgent (Priority Queue Jump).
 * Complies with SRS FR-1.6a & FR-1.6b by surfacing ETA differential and surcharge transparently.
 */

import React from 'react';
import type { PriorityTier } from '../types';
import { formatPaiseToRupees } from '../types';

export interface PriorityTierSelectorProps {
  value: PriorityTier;
  onChange: (tier: PriorityTier) => void;
  urgentSurchargePaise?: number | undefined;
  estimatedWaitMinutesFlexible?: number | undefined;
  estimatedWaitMinutesUrgent?: number | undefined;
  disabled?: boolean | undefined;
}

export function PriorityTierSelector({
  value,
  onChange,
  urgentSurchargePaise = 2000,
  estimatedWaitMinutesFlexible = 15,
  estimatedWaitMinutesUrgent = 4,
  disabled = false
}: PriorityTierSelectorProps) {
  return (
    <fieldset className="space-y-3">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-bold text-slate-800">
          Queue Priority Tier <span className="text-red-500">*</span>
        </legend>
        <span className="text-xs text-slate-400">Choose print speed</span>
      </div>

      <div
        role="radiogroup"
        aria-label="Queue priority tier selection"
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {/* Flexible Tier Card */}
        <button
          type="button"
          role="radio"
          aria-checked={value === 'flexible'}
          disabled={disabled}
          onClick={() => onChange('flexible')}
          className={`flex flex-col justify-between text-left p-4 rounded-2xl border-2 transition-all ${
            value === 'flexible'
              ? 'border-blue-600 bg-blue-50/50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm text-slate-900">Flexible Tier</span>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                  Standard
                </span>
              </div>
              <span
                className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  value === 'flexible' ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                }`}
                aria-hidden="true"
              >
                {value === 'flexible' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-3">
              Standard First-In-First-Out (FIFO) queue processing. Best for routine coursework and
              non-rush documents.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-400 font-medium">
              Est. Ready:{' '}
              <strong className="text-slate-800">~{estimatedWaitMinutesFlexible} min</strong>
            </span>
            <span className="font-bold text-emerald-600">No Surcharge</span>
          </div>
        </button>

        {/* Urgent Tier Card */}
        <button
          type="button"
          role="radio"
          aria-checked={value === 'urgent'}
          disabled={disabled}
          onClick={() => onChange('urgent')}
          className={`flex flex-col justify-between text-left p-4 rounded-2xl border-2 transition-all relative ${
            value === 'urgent'
              ? 'border-amber-500 bg-amber-50/50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm text-slate-900">Urgent Priority</span>
                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                  Queue Jump
                </span>
              </div>
              <span
                className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  value === 'urgent' ? 'border-amber-600 bg-amber-600' : 'border-slate-300 bg-white'
                }`}
                aria-hidden="true"
              >
                {value === 'urgent' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-3">
              Jumps ahead of all flexible jobs directly to the front of the print queue for
              immediate printing.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <span className="text-slate-400 font-medium">
              Est. Ready:{' '}
              <strong className="text-amber-800 font-bold">
                ~{estimatedWaitMinutesUrgent} min ⚡
              </strong>
            </span>
            <span className="font-bold text-amber-700">
              +{formatPaiseToRupees(urgentSurchargePaise)}
            </span>
          </div>
        </button>
      </div>
    </fieldset>
  );
}
