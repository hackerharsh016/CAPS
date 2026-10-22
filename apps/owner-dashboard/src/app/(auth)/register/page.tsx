'use client';

/**
 * Owner Self-Registration Page for CAPS Shop Owner Dashboard.
 * Renders the accessible RegisterForm with query param redirect preservation.
 */

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { RegisterForm } from '../../../features/auth/components/RegisterForm';
import { isAuthPath } from '../../../features/auth/route-guard-utils';

function RegisterContent() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');
  const redirectUrl =
    redirectParam && redirectParam.startsWith('/') && !isAuthPath(redirectParam)
      ? redirectParam
      : '/';

  return <RegisterForm redirectUrl={redirectUrl} />;
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 w-full max-w-md items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
