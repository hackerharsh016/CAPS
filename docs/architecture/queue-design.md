# CAPS — Two-Tier Dynamic Queue Design

> **Document:** `docs/architecture/queue-design.md`  
> **Status:** Architecture Baseline Locked  
> **Source Requirements:** `MINI_PROJECT_I_CAPS_SRS.md` §4.4 (FR-4.1a - FR-4.1d), §6 (UC-3)

---

## 1. Overview & Discipline

CAPS operates a **two-tier dynamic priority queue** per registered print shop:
- **Urgent Tier (`priority_tier = 'urgent'`):** Expedited priority jobs.
- **Flexible Tier (`priority_tier = 'flexible'`):** Standard FIFO jobs.

### Fundamental Queue Invariants
1. **FIFO Within Tier:** Within each tier, jobs are strictly ordered by payment confirmation timestamp (`enqueued_at ASC, id ASC`).
2. **Class Precedence:** An Urgent job is always dispatched ahead of all queued Flexible jobs.
3. **Non-Preemptive Execution:** An Urgent job **never preempts or cancels** a job currently in physical printing (`PRINTING` state). It inserts immediately behind the currently printing job and behind any previously queued Urgent jobs.
4. **Fairness Guards & Abuse Caps:** To prevent starvation of standard Flexible jobs during peak hours, shop owners can configure:
   - An hourly Urgent job quota (e.g., maximum 10 Urgent jobs per hour).
   - An Urgent surcharge multiplier or flat fee (e.g., +50% or ₹20 flat surcharge).

---

## 2. Queue Ordering Logic

The derived queue ranking query executed by Cloud API and the database RPC is:

```sql
SELECT 
    id,
    shop_id,
    customer_id,
    priority_tier,
    enqueued_at,
    ROW_NUMBER() OVER (
        PARTITION BY shop_id 
        ORDER BY 
            CASE priority_tier 
                WHEN 'urgent' THEN 0 
                ELSE 1 
            END ASC,
            enqueued_at ASC,
            id ASC
    ) AS effective_queue_position
FROM print_jobs
WHERE shop_id = :shop_id 
  AND status IN ('PAYMENT_CONFIRMED', 'OWNER_CONFIRMED', 'CLAIMED');
```

---

## 3. Dynamic ETA Calculation

The customer-facing Estimated Time of Arrival (ETA) is calculated dynamically based on:
1. **Base Service Time:** Sum of page counts of preceding jobs multiplied by the shop's average print speed (e.g., 20 pages/min $\rightarrow$ 3 seconds/page).
2. **Finishing Overhead:** Additional buffer time for manual binding, lamination, or stapling requirements specified in preceding jobs.
3. **Queue Insertion Recomputation:** When a new Urgent job is authorized:
   - The Urgent job is positioned ahead of all waiting Flexible jobs.
   - Cloud API recomputes downstream ETAs for all affected Flexible jobs.
   - Supabase Realtime emits position update events to affected customers with the revised ETA.

```text
[Current Printing] Job #101 (Flexible, 12 pages left)
  └── [Urgent Queue]
        ├── Job #105 (Urgent, 4 pages)  <-- Next to print
        └── Job #108 (Urgent, 10 pages) <-- Next after #105
  └── [Flexible Queue]
        ├── Job #102 (Flexible, 8 pages)  <-- Pushed behind #105 & #108
        └── Job #103 (Flexible, 15 pages) <-- Pushed behind #102
```
