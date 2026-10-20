'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../../features/auth/auth-context';
import {
  defaultQueueTrackingService,
  QueueTrackingCustomError
} from '../../../../features/queue-tracking/queue-tracking-service';
import type { JobTrackingInfo } from '../../../../features/queue-tracking/types';
import { JobTrackingView } from '../../../../features/queue-tracking/components/JobTrackingView';

export default function JobStatusPage() {
  const params = useParams<{ jobId: string }>();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const jobId = params?.jobId || '';
  const [tracking, setTracking] = useState<JobTrackingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<'UNAUTHORIZED' | 'NOT_FOUND' | 'ERROR' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchTracking = useCallback(async () => {
    if (!jobId) return;

    // Default to mock customer alpha if user is not loaded in dev/mock environment
    const effectiveCustomerId = user?.id || 'usr-customer-alpha';

    setIsLoading(true);
    setErrorCode(null);
    setErrorMessage(null);

    try {
      const data = await defaultQueueTrackingService.getJobTracking(jobId, effectiveCustomerId);
      setTracking(data);
    } catch (err: unknown) {
      if (err instanceof QueueTrackingCustomError) {
        if (err.code === 'UNAUTHORIZED') {
          setErrorCode('UNAUTHORIZED');
          setErrorMessage('You do not have permission to view this print job. Print jobs are private to each customer.');
        } else if (err.code === 'NOT_FOUND') {
          setErrorCode('NOT_FOUND');
          setErrorMessage(`Print job '${jobId}' was not found. It may have expired or the ID is invalid.`);
        } else {
          setErrorCode('ERROR');
          setErrorMessage(err.message);
        }
      } else {
        setErrorCode('ERROR');
        setErrorMessage('Failed to load job status. Please check your network connection.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [jobId, user?.id]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchTracking();
    }
  }, [isAuthLoading, fetchTracking]);

  // Loading Skeleton State
  if (isLoading || isAuthLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-6">
        <div className="h-6 w-36 bg-slate-200 rounded animate-pulse" />
        <div className="h-10 w-64 bg-slate-200 rounded animate-pulse" />
        <div className="h-44 bg-slate-100 border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-28 bg-slate-100 border border-slate-200 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  // Tenant / Authorization Error State (403)
  if (errorCode === 'UNAUTHORIZED') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Access Forbidden</h2>
        <p className="text-sm text-slate-600 mt-2">{errorMessage}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/orders"
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Go to My Orders
          </Link>
          {!isAuthenticated && (
            <Link
              href={`/login?redirectTo=/jobs/${jobId}`}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Sign In with Other Account
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Not Found State (404)
  if (errorCode === 'NOT_FOUND') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Print Job Not Found</h2>
        <p className="text-sm text-slate-600 mt-2">{errorMessage}</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/orders"
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            View My Orders
          </Link>
          <Link
            href="/print/new"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Upload New Document
          </Link>
        </div>
      </div>
    );
  }

  // General Network / Processing Error
  if (errorCode === 'ERROR' || !tracking) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Unable to Load Job Status</h2>
        <p className="text-sm text-slate-600 mt-2">{errorMessage}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={fetchTracking}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Retry Connection
          </button>
          <Link
            href="/orders"
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            Return to Orders
          </Link>
        </div>
      </div>
    );
  }

  return <JobTrackingView initialTracking={tracking} onRefresh={fetchTracking} />;
}
