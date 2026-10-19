import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistance,
  formatDistance,
  getDirectionsUrl
} from '../../src/features/shop-discovery/geo-utils';
import type { Coordinates } from '../../src/features/shop-discovery/types';

describe('Shop Discovery - Geo Utilities', () => {
  const coordA: Coordinates = { latitude: 12.9716, longitude: 77.5946 }; // Bangalore City Center
  const coordB: Coordinates = { latitude: 12.9784, longitude: 77.6408 }; // Indiranagar
  const coordSame: Coordinates = { latitude: 12.9716, longitude: 77.5946 };

  describe('calculateHaversineDistance', () => {
    it('returns 0 when coordinates are identical', () => {
      const distance = calculateHaversineDistance(coordA, coordSame);
      expect(distance).toBe(0);
    });

    it('calculates approximately correct distance between two known geographic points', () => {
      const distance = calculateHaversineDistance(coordA, coordB);
      // Actual straight-line distance is ~5000-5100m
      expect(distance).toBeGreaterThan(4900);
      expect(distance).toBeLessThan(5200);
    });

    it('is symmetric: distance(A, B) equals distance(B, A)', () => {
      const distAB = calculateHaversineDistance(coordA, coordB);
      const distBA = calculateHaversineDistance(coordB, coordA);
      expect(distAB).toBe(distBA);
    });
  });

  describe('formatDistance', () => {
    it('returns null for undefined, null, or NaN', () => {
      expect(formatDistance(undefined)).toBeNull();
      expect(formatDistance(null as unknown as number)).toBeNull();
      expect(formatDistance(NaN)).toBeNull();
    });

    it('formats distances under 1000m in meters', () => {
      expect(formatDistance(0)).toBe('0 m away');
      expect(formatDistance(45)).toBe('45 m away');
      expect(formatDistance(350.4)).toBe('350 m away');
      expect(formatDistance(999)).toBe('999 m away');
    });

    it('formats distances of 1000m and above in kilometers with 1 decimal place', () => {
      expect(formatDistance(1000)).toBe('1.0 km away');
      expect(formatDistance(1420)).toBe('1.4 km away');
      expect(formatDistance(5280)).toBe('5.3 km away');
    });
  });

  describe('getDirectionsUrl', () => {
    it('generates a Google Maps URL with encoded shop name and coordinates', () => {
      const url = getDirectionsUrl('Campus Xerox & Prints', {
        latitude: 12.971598,
        longitude: 77.594562
      });

      expect(url).toContain('https://www.google.com/maps/search/?api=1&query=');
      expect(url).toContain('Campus%20Xerox%20%26%20Prints');
      expect(url).toContain('12.971598');
      expect(url).toContain('77.594562');
    });
  });
});
