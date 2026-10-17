# ADR 0007: Transient Storage Lifecycle & Automated Purge Policies

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** CAPS Architecture & Development Team

## Context

Customer documents uploaded to CAPS may contain confidential, academic, legal, or personal identity information. Persisting documents in cloud storage or leaving cached copies in shop PC temp folders poses severe privacy, regulatory, and trust risks.

## Decision

1. **Private Cloud Storage:**
   - Uploaded documents are stored strictly in private, non-public Supabase Storage buckets.
   - Access is restricted via Row-Level Security (RLS) to the customer and via short-lived signed URLs (5-minute expiry) issued only to the paired shop agent holding an active lease.
2. **Immediate Local File Cleanup:**
   - The desktop agent downloads the document to a restricted local temp path (`AppData\Local\CAPS\temp`).
   - The file is deleted from local disk using `try...finally` immediately after Win32 spooler submission succeeds (or fails).
3. **Automated Cloud Purge Sweeper:**
   - A server-side cron worker deletes cloud storage objects 30 minutes after job completion, or after 24 hours regardless of outcome.
   - Anonymized audit logs (page counts, timestamps, pricing breakdown) are preserved for bookkeeping and disputes without retaining document payloads.
4. **Physical Boundary Transparency:**
   - Terms and documentation explicitly state that application cleanup purges application files, but cannot guarantee erasure of raw Windows spool files (`.SPL`) or printer onboard RAM.

## Consequences

### Positive
- Strict privacy compliance and protection against unauthorized data harvesting.
- Zero customer documents remain accessible on shop PC file systems post-printing.

### Negative / Trade-offs
- Documents cannot be reprinted without re-uploading if an issue is discovered after the retention window expires.
