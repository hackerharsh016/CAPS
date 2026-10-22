import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

describe('Next.js Edge Middleware — Owner Guards', () => {
  it('redirects unauthenticated request to /login with redirect parameter', () => {
    const req = new NextRequest('http://localhost:3001/queue');
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3001/login?redirect=%2Fqueue');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('redirects customer session attempting to access protected owner route', () => {
    const req = new NextRequest('http://localhost:3001/queue', {
      headers: {
        cookie: 'sb-access-token=mock-token; caps_user_role=customer'
      }
    });
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3001/login?error=customer_not_allowed'
    );
  });

  it('redirects authenticated owner on /login to dashboard root /', () => {
    const req = new NextRequest('http://localhost:3001/login', {
      headers: {
        cookie: 'sb-access-token=mock-token; caps_user_role=shop_owner'
      }
    });
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3001/');
  });

  it('allows authenticated owner on protected routes with security headers', () => {
    const req = new NextRequest('http://localhost:3001/queue', {
      headers: {
        cookie: 'sb-access-token=mock-token; caps_user_role=shop_owner'
      }
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('allows unauthenticated request to /login without redirect loop', () => {
    const req = new NextRequest('http://localhost:3001/login');
    const res = middleware(req);

    expect(res.status).toBe(200);
  });

  it('allows customer session to access /login without redirect loop', () => {
    const req = new NextRequest('http://localhost:3001/login?error=customer_not_allowed', {
      headers: {
        cookie: 'sb-access-token=mock-customer-token; caps_user_role=customer'
      }
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
  });

  it('allows request with cross-app token but missing role cookie to view /login', () => {
    const req = new NextRequest('http://localhost:3001/login', {
      headers: {
        cookie: 'sb-access-token=mock-token'
      }
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
  });

  it('redirects unauthenticated request on root / to /login without redundant query param', () => {
    const req = new NextRequest('http://localhost:3001/');
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3001/login');
  });

  it('prevents self-referential redirect loops when redirect param points to an auth route', () => {
    const req = new NextRequest('http://localhost:3001/login?redirect=%2Flogin', {
      headers: {
        cookie: 'sb-access-token=mock-token; caps_user_role=shop_owner'
      }
    });
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3001/');
  });
});
