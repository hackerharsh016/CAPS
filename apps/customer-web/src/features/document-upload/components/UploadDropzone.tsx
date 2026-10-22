'use client';

/**
 * Accessible Document Upload Dropzone component for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.2 & Master Plan Phase 4.
 * Supports drag-and-drop, keyboard activation, client preflight validation,
 * chunked progress tracking, upload cancellation, and error recovery.
 */

import React, { useState, useRef, useCallback } from 'react';
import type { UploadState, UploadedDocumentMetadata, UploadValidationError } from '../types';
import { validateDocumentPreflight, formatFileSizeBytes, MAX_FILE_SIZE_BYTES } from '../validation';
import { defaultUploadService } from '../upload-service';
import { UploadProgress } from './UploadProgress';
import { PrivacyNotice } from './PrivacyNotice';

export interface UploadDropzoneProps {
  targetShopId?: string | undefined;
  customerId?: string | undefined;
  onUploadSuccess?: ((doc: UploadedDocumentMetadata, file?: File) => void) | undefined;
  onUploadReset?: (() => void) | undefined;
}

export function UploadDropzone({
  targetShopId,
  customerId,
  onUploadSuccess,
  onUploadReset
}: UploadDropzoneProps) {
  const [state, setState] = useState<UploadState>({
    status: 'idle',
    file: null,
    progress: null,
    uploadedDoc: null,
    error: null
  });

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startUpload = useCallback(
    async (fileToUpload: File) => {
      // 1. Client-side preflight check
      setState({
        status: 'validating',
        file: fileToUpload,
        progress: null,
        uploadedDoc: null,
        error: null
      });

      const preflight = validateDocumentPreflight(fileToUpload);
      if (!preflight.valid && preflight.error) {
        setState({
          status: 'error',
          file: fileToUpload,
          progress: null,
          uploadedDoc: null,
          error: preflight.error
        });
        return;
      }

      // 2. Prepare AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setState({
        status: 'uploading',
        file: fileToUpload,
        progress: { loadedBytes: 0, totalBytes: fileToUpload.size, percentage: 0 },
        uploadedDoc: null,
        error: null
      });

      try {
        const metadata = await defaultUploadService.uploadDocument(fileToUpload, {
          targetShopId,
          customerId,
          signal: abortController.signal,
          onProgress: p => {
            setState(prev => ({
              ...prev,
              progress: p
            }));
          }
        });

        setState({
          status: 'success',
          file: fileToUpload,
          progress: {
            loadedBytes: fileToUpload.size,
            totalBytes: fileToUpload.size,
            percentage: 100
          },
          uploadedDoc: metadata,
          error: null
        });

        if (onUploadSuccess) {
          onUploadSuccess(metadata, fileToUpload);
        }
      } catch (err: unknown) {
        const uploadErr = err as UploadValidationError;
        if (uploadErr.code === 'ABORTED') {
          setState({
            status: 'aborted',
            file: fileToUpload,
            progress: null,
            uploadedDoc: null,
            error: uploadErr
          });
        } else {
          setState({
            status: 'error',
            file: fileToUpload,
            progress: null,
            uploadedDoc: null,
            error: uploadErr.message
              ? uploadErr
              : {
                  code: 'UPLOAD_FAILED',
                  message: 'Upload failed due to a network error. Please try again.'
                }
          });
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [targetShopId, onUploadSuccess]
  );

  const handleCancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleReset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setState({
      status: 'idle',
      file: null,
      progress: null,
      uploadedDoc: null,
      error: null
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (onUploadReset) {
      onUploadReset();
    }
  }, [onUploadReset]);

  const handleFileSelection = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file) {
        startUpload(file);
      }
    },
    [startUpload]
  );

  // Drag-and-drop handlers
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.status !== 'uploading') {
      setIsDraggingOver(true);
    }
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (state.status !== 'uploading' && e.dataTransfer.files) {
      handleFileSelection(e.dataTransfer.files);
    }
  };

  const handleZoneClick = () => {
    if (state.status !== 'uploading' && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (state.status !== 'uploading' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleZoneClick();
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.docx,.pptx,.txt"
        onChange={e => handleFileSelection(e.target.files)}
        className="sr-only"
        id="caps-document-file-input"
        aria-hidden="true"
      />

      {/* Uploading State: Progress Bar & Cancellation */}
      {state.status === 'uploading' && state.file && (
        <UploadProgress
          filename={state.file.name}
          totalSize={state.file.size}
          progress={state.progress}
          onCancel={handleCancelUpload}
        />
      )}

      {/* Success State: File Details & Replace Option */}
      {state.status === 'success' && state.uploadedDoc && (
        <div
          role="region"
          aria-label="Uploaded document details"
          className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center space-x-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-2xl text-emerald-700 font-bold">
                ✓
              </span>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-base font-bold text-slate-900 truncate max-w-sm sm:max-w-md">
                    {state.uploadedDoc.name}
                  </h3>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    Uploaded
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Size: {formatFileSizeBytes(state.uploadedDoc.sizeBytes)} • Format:{' '}
                  {state.uploadedDoc.extension.toUpperCase().replace('.', '')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              Replace Document
            </button>
          </div>

          <div className="rounded-xl bg-white p-3.5 text-xs text-slate-600 border border-emerald-100 flex items-center justify-between">
            <span className="truncate">
              <strong>Storage ID:</strong> {state.uploadedDoc.id}
            </span>
            <span className="text-emerald-700 font-medium ml-2 shrink-0">🔒 Encrypted at rest</span>
          </div>
        </div>
      )}

      {/* Error / Aborted State Banner */}
      {(state.status === 'error' || state.status === 'aborted') && state.error && (
        <div
          role="alert"
          aria-live="polite"
          className={`rounded-2xl border p-5 ${
            state.status === 'aborted'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start space-x-2.5">
              <span className="text-lg">{state.status === 'aborted' ? '⚠️' : '❌'}</span>
              <div>
                <p className="text-sm font-bold">
                  {state.status === 'aborted' ? 'Upload Cancelled' : 'Upload Error'}
                </p>
                <p className="text-xs mt-0.5 text-slate-700">{state.error.message}</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {state.file && (
                <button
                  type="button"
                  onClick={() => startUpload(state.file!)}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                >
                  Retry Upload
                </button>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
              >
                Choose Another File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Drag-and-Drop Area (Visible when idle, validating, or error/aborted) */}
      {state.status !== 'uploading' && state.status !== 'success' && (
        <div
          role="button"
          tabIndex={0}
          onClick={handleZoneClick}
          onKeyDown={handleKeyDown}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          aria-label="Upload document dropzone. Drag and drop file here or press Enter to browse."
          className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-all cursor-pointer outline-none focus:ring-4 focus:ring-blue-100 ${
            isDraggingOver
              ? 'border-blue-600 bg-blue-50/70 scale-[1.01]'
              : 'border-slate-300 bg-slate-50/50 hover:border-blue-500 hover:bg-blue-50/30'
          }`}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 group-hover:scale-110 transition-transform">
            <svg
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>

          <h3 className="mt-4 text-base font-bold text-slate-900">
            {isDraggingOver
              ? 'Drop your document right here'
              : 'Drag & drop your document here, or browse'}
          </h3>

          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            Supports PDF, JPG, PNG, DOCX, PPTX, and TXT files up to{' '}
            {formatFileSizeBytes(MAX_FILE_SIZE_BYTES)}.
          </p>

          <div
            className="mt-5 flex flex-wrap justify-center gap-1.5"
            aria-label="Supported document types"
          >
            {['PDF', 'JPG', 'PNG', 'DOCX', 'PPTX', 'TXT'].map(type => (
              <span
                key={type}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600"
              >
                {type}
              </span>
            ))}
          </div>

          <button
            type="button"
            className="mt-6 inline-flex items-center rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm group-hover:bg-blue-700 transition-colors pointer-events-none"
            tabIndex={-1}
          >
            Browse from Device
          </button>
        </div>
      )}

      {/* Privacy Notice Banner */}
      <PrivacyNotice />
    </div>
  );
}
