'use client';

/**
 * Customer Sign-In Page.
 * Renders the accessible LoginForm with destination redirect preservation.
 */

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoginForm } from '../../../features/auth/components/LoginForm';

function LoginContent() {
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const redirect = rawRedirect && rawRedirect.startsWith('/') ? rawRedirect : '/orders';

  return <LoginForm redirectTo={redirect} />;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 w-full max-w-md items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
