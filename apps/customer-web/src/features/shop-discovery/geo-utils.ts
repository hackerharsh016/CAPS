'use client';

/**
 * Geolocation and Distance utilities for CAPS Shop Discovery.
 * Implements Haversine distance calculation, distance formatting,
 * and a resilient browser geolocation hook with permission fallback.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Coordinates, GeolocationState, GeolocationStatus } from './types';

/**
 * Calculates distance in meters between two geographical points using Haversine formula.
 */
export function calculateHaversineDistance(
  coord1: Coordinates,
  coord2: Coordinates
): number {
  const R = 6371000; // Earth's radius in meters
  const lat1Rad = (coord1.latitude * Math.PI) / 180;
  const lat2Rad = (coord2.latitude * Math.PI) / 180;
  const deltaLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
  const deltaLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Formats distance in meters to user-friendly label (e.g. "350 m away" or "1.4 km away").
 */
export function formatDistance(meters?: number): string | null {
  if (meters === undefined || meters === null || isNaN(meters)) {
    return null;
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m away`;
  }
  return `${(meters / 1000).toFixed(1)} km away`;
}

/**
 * Generates external Google Maps directions link for map-free fallback.
 */
export function getDirectionsUrl(shopName: string, coords: Coordinates): string {
  const query = encodeURIComponent(`${shopName} ${coords.latitude},${coords.longitude}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function useGeolocation(): GeolocationState & { requestLocation: () => void } {
  const [state, setState] = useState<GeolocationState>({
    status: 'idle',
    coordinates: null,
    errorMessage: null
  });

  const requestLocation = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setState({
        status: 'unavailable',
        coordinates: null,
        errorMessage: 'Geolocation is not supported by your browser.'
      });
      return;
    }

    setState((prev) => ({ ...prev, status: 'loading', errorMessage: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          status: 'granted',
          coordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          },
          errorMessage: null
        });
      },
      (error) => {
        let status: GeolocationStatus = 'unavailable';
        let errorMessage = 'Unable to determine your location.';

        if (error.code === error.PERMISSION_DENIED) {
          status = 'denied';
          errorMessage =
            'Location access was denied. Showing all nearby shops sorted by popularity.';
        } else if (error.code === error.TIMEOUT) {
          errorMessage = 'Location request timed out. Showing all shops.';
        }

        setState({
          status,
          coordinates: null,
          errorMessage
        });
      },
      {
        timeout: 10000,
        maximumAge: 60000,
        enableHighAccuracy: false
      }
    );
  }, []);

  // Request location once upon mounting if idle
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  return { ...state, requestLocation };
}
