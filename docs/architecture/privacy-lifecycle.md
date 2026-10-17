# CAPS — Privacy Lifecycle & Document Retention

> **Document:** `docs/architecture/privacy-lifecycle.md`  
> **Status:** Architecture Baseline Locked  
> **Source Requirements:** `MINI_PROJECT_I_CAPS_SRS.md` §4.4 (FR-4.3), §6 (UC-4), §8.7

---

## 1. Privacy-by-Design Philosophy

Customer documents frequently contain sensitive, private, or regulatory data (academic certificates, legal contracts, identification cards, financial statements). The CAPS architecture implements strict **transient-only storage** across both cloud infrastructure and the local shop PC.

---

## 2. Document Retention Timeline

```text
Upload Intent Created
       │
       ▼  (Valid for 15 minutes)
Direct Upload to Encrypted Private Cloud Bucket
       │
       ▼  (Private object access granted ONLY to destination shop agent)
Payment Verified & Owner Confirmed
       │
       ▼
Print Agent Claims & Downloads to Protected Temp Directory
       │  (C:\Users\<User>\AppData\Local\CAPS\temp\...)
       ▼
Print Submitted to Windows Spooler
       │
       ├──► Local Agent Action: Immediate, secure deletion of local file
       │
       ▼
Job Completed / Failed / Expired
       │
       ▼  (Scheduled Cloud Purge Worker: 30 minutes post-completion, max 24 hours)
Permanent Deletion of Cloud Storage Object
       │
       ▼
Anonymized Metadata Audit Preserved (Page counts, timings, pricing, status history)
```

---

## 3. Storage & Access Controls

### A. Cloud Storage Bucket (`caps-documents`)
- **Private Access:** The bucket is configured as private; public reads are strictly prohibited.
- **Short-Lived Signed URLs:** The cloud API issues signed download URLs valid for a maximum of 300 seconds (5 minutes), scoped strictly to the authenticated agent with an active lease.
- **Encryption at Rest:** Storage objects are encrypted using AES-256 server-side encryption.

### B. Local Shop PC Protection
- **Temp Directory Permissions:** The print agent creates its temporary download directory under restricted user AppData with Windows ACLs restricted to the current user/service account.
- **Immediate Local Deletion:** The file is deleted from disk using `os.remove()` in a `try...finally` block immediately after the Windows spooler accepts the raster job, even if submission encounters errors.
- **Boot Cleanup Sweeper:** Upon starting, the agent enumerates its temporary directory and deletes any orphaned files from previous interrupted runs.

### C. Cloud Automated Purge Worker
- A periodic background worker (`document-cleanup.job.ts`) queries jobs where:
  ```sql
  status IN ('COMPLETED', 'FAILED', 'CANCELLED') 
    AND (completed_at < NOW() - INTERVAL '30 minutes' OR created_at < NOW() - INTERVAL '24 hours')
    AND document_url IS NOT NULL;
  ```
- The worker invokes the Supabase Storage deletion API, sets `document_url = NULL`, and appends an audit event to `job_events`.

---

## 4. Realistic Privacy Boundaries & Disclaimers

> [!IMPORTANT]
> While CAPS guarantees that application-level temporary files and cloud storage objects are purged permanently:
> 1. It cannot guarantee erasure of raw spooler shadow files (`.SHD` / `.SPL`) managed by the Windows Print Spooler subsystem until Windows purges them.
> 2. It cannot guarantee erasure of internal volatile or non-volatile memory inside physical printer hardware (e.g., printer RAM/hard drives).
> 
> Product documentation and terms of service must explicitly reflect these OS and physical hardware boundaries.
