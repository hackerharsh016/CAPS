/**
 * Next.js Edge Middleware for CAPS Shop Owner Dashboard.
 * Enforces server-side route guards, role protection, and security headers.
 *
 * Conforms to Master Plan Section 4 & SRS 4.2.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  isProtectedPath,
  isAuthPath,
  createLoginRedirectUrl
} from './features/auth/route-guard-utils';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const accessTokenCookie = request.cookies.get('sb-access-token');
  const sessionCookie = request.cookies.get('caps_auth_session');
  const userRoleCookie = request.cookies.get('caps_user_role')?.value;

  const hasToken = !!(accessTokenCookie?.value || sessionCookie?.value);
  const isCustomer = userRoleCookie === 'customer';

  // 1. If accessing auth pages (/login) while already logged in as owner/admin
  if (isAuthPath(pathname) && hasToken && !isCustomer) {
    const redirectParam = request.nextUrl.searchParams.get('redirect');
    const destination =
      redirectParam && redirectParam.startsWith('/') && !isAuthPath(redirectParam)
        ? redirectParam
        : '/';
    const response = NextResponse.redirect(new URL(destination, request.url));
    applySecurityHeaders(response);
    return response;
  }

  // 2. If user is logged in as a customer, prevent access to protected owner pages
  if (isProtectedPath(pathname) && hasToken && isCustomer) {
    const loginUrl = new URL('/login?error=customer_not_allowed', request.url);
    const response = NextResponse.redirect(loginUrl);
    applySecurityHeaders(response);
    return response;
  }

  // 3. If accessing protected routes without session
  if (isProtectedPath(pathname) && !hasToken) {
    const loginUrl = createLoginRedirectUrl(pathname + request.nextUrl.search);
    const response = NextResponse.redirect(new URL(loginUrl, request.url));
    applySecurityHeaders(response);
    return response;
  }

  // 4. Allowed: proceed with request and append security headers
  const response = NextResponse.next();
  applySecurityHeaders(response);
  return response;
}

function applySecurityHeaders(response: NextResponse): void {
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files
     */
    '/((?!_next/static|_next/image|favicon.ico).*)'
  ]
};
