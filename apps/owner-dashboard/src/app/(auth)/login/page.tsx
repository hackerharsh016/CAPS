'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LoginForm } from '../../../features/auth/components/LoginForm';

function LoginContent() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');
  const redirectUrl = redirectParam && redirectParam.startsWith('/') ? redirectParam : '/';

  return <LoginForm redirectUrl={redirectUrl} />;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 w-full max-w-md items-center justify-center rounded-2xl border border-slate-200 bg-white p-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
