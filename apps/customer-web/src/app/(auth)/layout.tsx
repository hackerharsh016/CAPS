import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In / Register — CAPS Customer',
  description: 'Access your CAPS customer account to manage your print orders and documents.'
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-80px)] flex-col justify-center py-6 sm:py-12 px-3 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <a href="/" className="inline-flex items-center space-x-2">
          <span className="rounded-lg bg-blue-600 px-3.5 py-1.5 font-mono text-base font-bold text-white shadow-xs">
            CAPS
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            Automated Printing
          </span>
        </a>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md flex justify-center px-0">
        {children}
      </div>

      <div className="mt-8 text-center text-xs text-slate-500">
        <p>🔒 End-to-end encrypted document handling & automated print completion</p>
      </div>
    </div>
  );
}
