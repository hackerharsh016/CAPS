'use client';

/**
 * Authentication React Context & Hook for CAPS Shop Owner Dashboard.
 * Enforces role checks, synchronizes tokens, and isolates owner operations.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { AuthError, AuthSession, AuthStatus, AuthUser, UserProfile } from './types';
import {
  SupabaseAuthClient,
  type SignInCredentials,
  RoleGuardError
} from './supabase-auth-client';
import { getSupabaseBrowserClient } from '../../lib/supabase';

export interface AuthContextValue {
  user: AuthUser | null;
  session: AuthSession | null;
  profile: UserProfile | null;
  status: AuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOwnerOrAdmin: boolean;
  error: AuthError | null;
  signInWithPassword: (credentials: SignInCredentials) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<AuthSession | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: React.ReactNode;
  authClient?: SupabaseAuthClient | undefined;
}

export function AuthProvider({ children, authClient: customAuthClient }: AuthProviderProps) {
  const client = useMemo(
    () => customAuthClient ?? getSupabaseBrowserClient(),
    [customAuthClient]
  );

  const [session, setSession] = useState<AuthSession | null>(() => client.getSession());
  const [profile, setProfile] = useState<UserProfile | null>(() => client.getProfile());
  const [status, setStatus] = useState<AuthStatus>(() => {
    const initialSession = client.getSession();
    if (!initialSession) return 'unauthenticated';
    const initialProfile = client.getProfile();
    if (initialProfile && initialProfile.role === 'customer') return 'forbidden';
    return 'authenticated';
  });
  const [error, setError] = useState<AuthError | null>(null);

  useEffect(() => {
    const { unsubscribe } = client.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      const newProfile = client.getProfile();
      setProfile(newProfile);

      if (!newSession) {
        setStatus('unauthenticated');
      } else if (newProfile && newProfile.role === 'customer') {
        setStatus('forbidden');
      } else {
        setStatus('authenticated');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [client]);

  const signInWithPassword = useCallback(
    async (credentials: SignInCredentials) => {
      setError(null);
      try {
        const result = await client.signInWithPassword(credentials);
        setSession(result.session);
        setProfile(result.profile);
        setStatus('authenticated');
      } catch (err: unknown) {
        if (err instanceof RoleGuardError) {
          const authErr: AuthError = {
            code: err.code,
            message: err.message,
            status: err.status
          };
          setError(authErr);
          setStatus('forbidden');
          throw authErr;
        }

        const authErr = err as AuthError;
        setError(authErr);
        setStatus('unauthenticated');
        throw authErr;
      }
    },
    [client]
  );

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await client.signOut();
      setSession(null);
      setProfile(null);
      setStatus('unauthenticated');
    } catch (err) {
      const authErr = err as AuthError;
      setError(authErr);
    }
  }, [client]);

  const refreshSession = useCallback(async () => {
    try {
      const refreshed = await client.refreshSession();
      setSession(refreshed);
      const updatedProfile = client.getProfile();
      setProfile(updatedProfile);
      return refreshed;
    } catch {
      return null;
    }
  }, [client]);

  const isLoading = status === 'loading';
  const isAuthenticated = status === 'authenticated' && !!session;
  const isOwnerOrAdmin =
    isAuthenticated && (profile?.role === 'shop_owner' || profile?.role === 'admin');

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      status,
      isLoading,
      isAuthenticated,
      isOwnerOrAdmin,
      error,
      signInWithPassword,
      signOut,
      refreshSession
    }),
    [
      session,
      profile,
      status,
      isLoading,
      isAuthenticated,
      isOwnerOrAdmin,
      error,
      signInWithPassword,
      signOut,
      refreshSession
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}
