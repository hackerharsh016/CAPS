'use client';

/**
 * Client App Providers wrapping AuthProvider and ShopProvider.
 */

import React from 'react';
import { AuthProvider } from '../features/auth/auth-context';
import { ShopProvider } from '../features/shop-management/shop-context';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ShopProvider>{children}</ShopProvider>
    </AuthProvider>
  );
}
