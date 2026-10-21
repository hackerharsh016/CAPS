import React from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center space-x-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold text-xl shadow-sm">
          C
        </div>
        <div className="text-left">
          <span className="block text-lg font-bold tracking-tight text-slate-900">CAPS</span>
          <span className="block text-xs font-medium text-slate-500">Shop Owner Operations</span>
        </div>
      </div>
      {children}
    </div>
  );
}
