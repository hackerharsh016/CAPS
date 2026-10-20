/**
 * Authentication and identity types for CAPS Shop Owner Dashboard.
 * Aligned with CAPS SRS Sections 4.2, 7.1 and Master Plan Section 4.
 */

export type UserRole = 'customer' | 'shop_owner' | 'admin';

export interface UserProfile {
  id: string; // UUID referencing auth.users
  role: UserRole;
  name: string;
  phone: string;
  email?: string | undefined;
  created_at: string;
  updated_at?: string | undefined;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number; // Duration in seconds
  expires_at: number; // Unix timestamp in seconds
  token_type: string;
}

export interface AuthUser {
  id: string;
  email?: string | undefined;
  phone?: string | undefined;
  user_metadata?:
    | {
        name?: string | undefined;
        phone?: string | undefined;
        role?: UserRole | undefined;
        [key: string]: unknown;
      }
    | undefined;
  app_metadata?:
    | {
        role?: UserRole | undefined;
        provider?: string | undefined;
        [key: string]: unknown;
      }
    | undefined;
  created_at: string;
}

export interface AuthSession extends AuthTokens {
  user: AuthUser;
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED';

export type AuthStateChangeCallback = (event: AuthChangeEvent, session: AuthSession | null) => void;

export interface AuthError {
  code: string;
  message: string;
  status?: number | undefined;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'forbidden';

export interface RouteAccessResult {
  allowed: boolean;
  redirectUrl: string | null;
  reason:
    | 'AUTHENTICATED'
    | 'UNAUTHENTICATED'
    | 'EXPIRED'
    | 'ROLE_MISMATCH'
    | 'PUBLIC_ROUTE'
    | 'ALREADY_AUTHENTICATED'
    | 'CROSS_SHOP_FORBIDDEN';
}

export interface RouteGuardProps {
  children: React.ReactNode;
  requiredRole?: UserRole | undefined;
  redirectTo?: string | undefined;
  fallback?: React.ReactNode | undefined;
}
