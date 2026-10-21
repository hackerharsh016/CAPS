'use client';

/**
 * Paper Pricing Table Component for CAPS Owner Dashboard.
 * Accessible matrix for editing A4, A3, Legal single and double-sided prices.
 */

import React from 'react';
import type { PricingConfig, PricingFormErrors, PaperSize } from '../types';
import { paiseToRupees, rupeesToPaise } from '../types';

export interface PaperPricingTableProps {
  config: PricingConfig;
  errors: PricingFormErrors;
  onChange: (
    size: PaperSize,
    field: 'bw_single_paise' | 'bw_double_paise' | 'color_single_paise' | 'color_double_paise',
    valuePaise: number
  ) => void;
  disabled?: boolean | undefined;
}

export function PaperPricingTable({
  config,
  errors,
  onChange,
  disabled = false
}: PaperPricingTableProps) {
  const paperSizes: PaperSize[] = ['A4', 'A3', 'Legal'];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-bold text-slate-900">Per-Page Printing Rates</h3>
        <p className="text-xs text-slate-500">
          Set base prices in Rupees (₹) per page. Rates automatically convert to paise for billing.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-700 font-semibold">
              <th scope="col" className="py-3 px-4">
                Paper Size
              </th>
              <th scope="col" className="py-3 px-4">
                B/W Single (₹)
              </th>
              <th scope="col" className="py-3 px-4">
                B/W Double (₹)
              </th>
              <th scope="col" className="py-3 px-4">
                Color Single (₹)
              </th>
              <th scope="col" className="py-3 px-4">
                Color Double (₹)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paperSizes.map(size => {
              const paper = config[size];
              const bwSingleErr = errors[`${size}.bw_single` as keyof PricingFormErrors];
              const bwDoubleErr = errors[`${size}.bw_double` as keyof PricingFormErrors];
              const colSingleErr = errors[`${size}.color_single` as keyof PricingFormErrors];
              const colDoubleErr = errors[`${size}.color_double` as keyof PricingFormErrors];

              return (
                <tr key={size} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-900">{size}</td>

                  {/* B/W Single */}
                  <td className="py-3 px-4">
                    <label htmlFor={`${size}-bw-single`} className="sr-only">
                      {size} Black and White Single-Sided Price in Rupees
                    </label>
                    <input
                      id={`${size}-bw-single`}
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={disabled}
                      value={paiseToRupees(paper.bw_single_paise)}
                      onChange={e =>
                        onChange(size, 'bw_single_paise', rupeesToPaise(Number(e.target.value)))
                      }
                      aria-invalid={!!bwSingleErr}
                      aria-describedby={bwSingleErr ? `${size}-bw-single-err` : undefined}
                      className={`w-24 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                        bwSingleErr
                          ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                          : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
                      }`}
                    />
                    {bwSingleErr && (
                      <p
                        id={`${size}-bw-single-err`}
                        role="alert"
                        className="mt-1 text-[11px] text-rose-600"
                      >
                        {bwSingleErr}
                      </p>
                    )}
                  </td>

                  {/* B/W Double */}
                  <td className="py-3 px-4">
                    <label htmlFor={`${size}-bw-double`} className="sr-only">
                      {size} Black and White Double-Sided Price in Rupees
                    </label>
                    <input
                      id={`${size}-bw-double`}
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={disabled}
                      value={paiseToRupees(paper.bw_double_paise)}
                      onChange={e =>
                        onChange(size, 'bw_double_paise', rupeesToPaise(Number(e.target.value)))
                      }
                      aria-invalid={!!bwDoubleErr}
                      aria-describedby={bwDoubleErr ? `${size}-bw-double-err` : undefined}
                      className={`w-24 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                        bwDoubleErr
                          ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                          : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
                      }`}
                    />
                    {bwDoubleErr && (
                      <p
                        id={`${size}-bw-double-err`}
                        role="alert"
                        className="mt-1 text-[11px] text-rose-600"
                      >
                        {bwDoubleErr}
                      </p>
                    )}
                  </td>

                  {/* Color Single */}
                  <td className="py-3 px-4">
                    <label htmlFor={`${size}-col-single`} className="sr-only">
                      {size} Color Single-Sided Price in Rupees
                    </label>
                    <input
                      id={`${size}-col-single`}
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={disabled}
                      value={paiseToRupees(paper.color_single_paise)}
                      onChange={e =>
                        onChange(size, 'color_single_paise', rupeesToPaise(Number(e.target.value)))
                      }
                      aria-invalid={!!colSingleErr}
                      aria-describedby={colSingleErr ? `${size}-col-single-err` : undefined}
                      className={`w-24 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                        colSingleErr
                          ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                          : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
                      }`}
                    />
                    {colSingleErr && (
                      <p
                        id={`${size}-col-single-err`}
                        role="alert"
                        className="mt-1 text-[11px] text-rose-600"
                      >
                        {colSingleErr}
                      </p>
                    )}
                  </td>

                  {/* Color Double */}
                  <td className="py-3 px-4">
                    <label htmlFor={`${size}-col-double`} className="sr-only">
                      {size} Color Double-Sided Price in Rupees
                    </label>
                    <input
                      id={`${size}-col-double`}
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={disabled}
                      value={paiseToRupees(paper.color_double_paise)}
                      onChange={e =>
                        onChange(size, 'color_double_paise', rupeesToPaise(Number(e.target.value)))
                      }
                      aria-invalid={!!colDoubleErr}
                      aria-describedby={colDoubleErr ? `${size}-col-double-err` : undefined}
                      className={`w-24 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                        colDoubleErr
                          ? 'border-rose-400 bg-rose-50 text-rose-900 focus:border-rose-500'
                          : 'border-slate-300 bg-white text-slate-900 focus:border-emerald-500'
                      }`}
                    />
                    {colDoubleErr && (
                      <p
                        id={`${size}-col-double-err`}
                        role="alert"
                        className="mt-1 text-[11px] text-rose-600"
                      >
                        {colDoubleErr}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
