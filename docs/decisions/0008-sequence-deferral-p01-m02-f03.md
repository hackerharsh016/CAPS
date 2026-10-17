# ADR 0008: Execution Sequence Deferral of P01-M02-F03 for Docs Baseline

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** CAPS Architecture & Development Team

## Context

In `TASK_MANIFEST.json`, task `P01-M02-F03` ("Typed API client and shared UI") was scheduled as sequence 7, immediately followed by `P01-M03-F01` ("Developer documentation and ADRs") as sequence 8.

The team received an explicit direction to establish the developer documentation, ADR repository, architecture baseline, and contribution runbooks (`P01-M03-F01`) to align the multi-developer ownership map and architectural invariants before finalizing the UI design system and HTTP client wrapper implementation.

## Decision

We formally defer `P01-M02-F03` to execute immediately following `P01-M03-F01`:
1. `P01-M03-F01` establishes the foundational developer documentation, architecture guides, and ADRs.
2. `P01-M02-F03` (`packages/api-client` and `packages/ui`) will be implemented with reference to the documented standards, ADRs, and ownership boundaries.
3. This sequence adjustment is audited in `IMPLEMENTATION_STATUS.md` and tracked here as an explicit architectural decision.

## Consequences

### Positive
- Clear developer standards, environment matrices, and runbooks established for all developers before shared UI and API client implementation.
- Architectural consensus documented before further codebase expansion.

### Negative / Trade-offs
- Task manifest sequence 7 and 8 executed in adjusted sequence.
