# @caps/validation

Shared Zod validation schemas and parsing utilities for CAPS.

## Enforced Invariants

- **Strict Property Validation:** All public request schemas use `.strict()` to prevent rogue property injection.
- **Copy Limits:** Copy counts are strictly bounded between `1` and `100` inclusive.
- **Page Ranges:** Page range expressions accept `'all'` or validated comma/dash patterns (`1-5, 8`), rejecting inverted or malformed ranges.
- **Currency Minor Units:** All monetary calculations and breakdowns are enforced as non-negative integer paise.
