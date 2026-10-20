'use client';

/**
 * React Context and Hook for authentication in CAPS Customer Web.
 * Provides real-time reactive auth state, token refreshes, and auth actions.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type {
  AuthError,
  AuthSession,
  AuthStatus,
  AuthUser,
  UserProfile,
  UserRole
} from './types';
import {
  SupabaseAuthClient,
  type SignInCredentials,
  type SignUpCredentials,
  type OtpCredentials,
  type VerifyOtpCredentials
} from './supabase-auth-client';
import { getSupabaseBrowserClient } from '../../lib/supabase';

export interface AuthContextValue {
  user: AuthUser | null;
  session: AuthSession | null;
  profile: UserProfile | null;
  status: AuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: AuthError | null;
  signInWithPassword: (credentials: SignInCredentials) => Promise<void>;
  signInWithOtp: (credentials: OtpCredentials) => Promise<{ message: string }>;
  verifyOtp: (credentials: VerifyOtpCredentials) => Promise<void>;
  signUp: (credentials: SignUpCredentials) => Promise<{ user: AuthUser; session: AuthSession | null }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<AuthSession | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: React.ReactNode;
  client?: SupabaseAuthClient | undefined;
}

export function AuthProvider({ children, client }: AuthProviderProps) {
  const authClient = useMemo(() => client ?? getSupabaseBrowserClient(), [client]);

  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<AuthError | null>(null);

  // Derive profile from user metadata and session
  const profile = useMemo<UserProfile | null>(() => {
    if (!user) return null;
    const role: UserRole =
      user.user_metadata?.role || user.app_metadata?.role || 'customer';
    const profileName =
      (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
      user.email?.split('@')[0] ||
      'Customer';
    const profilePhone =
      user.phone ||
      (typeof user.user_metadata?.phone === 'string' ? user.user_metadata.phone : '') ||
      '';

    const p: UserProfile = {
      id: user.id,
      role,
      name: profileName,
      phone: profilePhone,
      created_at: user.created_at
    };
    if (user.email !== undefined) {
      p.email = user.email;
    }
    return p;
  }, [user]);

  // Sync session and status on changes
  const handleAuthState = useCallback((newSession: AuthSession | null) => {
    setSession(newSession);
    setUser(newSession?.user ?? null);
    setStatus(newSession ? 'authenticated' : 'unauthenticated');
    setError(null);
  }, []);

  // Initialize and listen for auth state changes
  useEffect(() => {
    let mounted = true;

    // Check existing session
    authClient
      .getSession()
      .then((existingSession) => {
        if (mounted) {
          handleAuthState(existingSession);
        }
      })
      .catch((err) => {
        if (mounted) {
          console.error('Error hydrating auth session:', err);
          handleAuthState(null);
        }
      });

    // Subscribe to events
    const unsubscribe = authClient.onAuthStateChange((_event, updatedSession) => {
      if (mounted) {
        handleAuthState(updatedSession);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [authClient, handleAuthState]);

  const signInWithPassword = useCallback(
    async (credentials: SignInCredentials) => {
      setError(null);
      try {
        const { session: newSession } = await authClient.signInWithPassword(credentials);
        handleAuthState(newSession);
      } catch (err) {
        const authErr = err as AuthError;
        setError(authErr);
        throw authErr;
      }
    },
    [authClient, handleAuthState]
  );

  const signInWithOtp = useCallback(
    async (credentials: OtpCredentials) => {
      setError(null);
      try {
        return await authClient.signInWithOtp(credentials);
      } catch (err) {
        const authErr = err as AuthError;
        setError(authErr);
        throw authErr;
      }
    },
    [authClient]
  );

  const verifyOtp = useCallback(
    async (credentials: VerifyOtpCredentials) => {
      setError(null);
      try {
        const { session: newSession } = await authClient.verifyOtp(credentials);
        handleAuthState(newSession);
      } catch (err) {
        const authErr = err as AuthError;
        setError(authErr);
        throw authErr;
      }
    },
    [authClient, handleAuthState]
  );

  const signUp = useCallback(
    async (credentials: SignUpCredentials) => {
      setError(null);
      try {
        const res = await authClient.signUp(credentials);
        if (res.session) {
          handleAuthState(res.session);
        }
        return res;
      } catch (err) {
        const authErr = err as AuthError;
        setError(authErr);
        throw authErr;
      }
    },
    [authClient, handleAuthState]
  );

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await authClient.signOut();
    } finally {
      handleAuthState(null);
    }
  }, [authClient, handleAuthState]);

  const refreshSession = useCallback(async () => {
    if (!session?.refresh_token) {
      return null;
    }
    const refreshed = await authClient.refreshSession(session.refresh_token);
    handleAuthState(refreshed);
    return refreshed;
  }, [authClient, session, handleAuthState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      status,
      isLoading: status === 'loading',
      isAuthenticated: status === 'authenticated',
      error,
      signInWithPassword,
      signInWithOtp,
      verifyOtp,
      signUp,
      signOut,
      refreshSession
    }),
    [
      user,
      session,
      profile,
      status,
      error,
      signInWithPassword,
      signInWithOtp,
      verifyOtp,
      signUp,
      signOut,
      refreshSession
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return context;
}
