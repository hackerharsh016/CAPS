import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../src/middleware';

describe('Next.js Edge Middleware Route Guards', () => {
  const createMockRequest = (
    path: string,
    cookies: Record<string, string> = {}
  ): NextRequest => {
    const url = `https://caps.example.com${path}`;
    const req = new NextRequest(url);

    for (const [key, value] of Object.entries(cookies)) {
      req.cookies.set(key, value);
    }

    return req;
  };

  it('allows public routes (/shops) to pass through without redirect', () => {
    const req = createMockRequest('/shops');
    const res = middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('redirects unauthenticated request to /orders to /login?redirect=/orders', () => {
    const req = createMockRequest('/orders');
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/login?redirect=%2Forders');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('redirects unauthenticated request to /profile to /login?redirect=/profile', () => {
    const req = createMockRequest('/profile');
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?redirect=%2Fprofile');
  });

  it('allows protected route (/orders) to pass through when sb-access-token cookie exists', () => {
    const req = createMockRequest('/orders', {
      'sb-access-token': 'valid-jwt-token'
    });
    const res = middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('redirects authenticated user on /login to /orders', () => {
    const req = createMockRequest('/login', {
      'sb-access-token': 'valid-jwt-token'
    });
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://caps.example.com/orders');
  });

  it('redirects authenticated user on /login with ?redirect=/print/new to destination', () => {
    const req = createMockRequest('/login?redirect=%2Fprint%2Fnew', {
      'sb-access-token': 'valid-jwt-token'
    });
    const res = middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://caps.example.com/print/new');
  });
});
