'use client';

/**
 * Customer Registration Page.
 * Renders the accessible RegisterForm with destination redirect preservation.
 */

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { RegisterForm } from '../../../features/auth/components/RegisterForm';

function RegisterContent() {
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const redirect = rawRedirect && rawRedirect.startsWith('/') ? rawRedirect : '/orders';

  return <RegisterForm redirectTo={redirect} />;
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 w-full max-w-md items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
