# ADR 0003: Desktop Agent Outbound-Only & Strict Loopback Binding

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** CAPS Architecture & Development Team

## Context

Shop print computers are typically situated behind residential/commercial NAT routers, dynamic IP allocations, and local firewalls. Exposing an inbound HTTP port on the agent to receive print commands from the cloud would require port forwarding, DDNS, public TLS certificates per shop, and introduce a severe vulnerability surface to the shop's local network.

## Decision

1. **Outbound-Only Communication:**
   - The Print Agent connects to the Cloud API exclusively via outbound HTTPS and WebSocket (WSS) connections.
   - The agent pulls authorized work using atomic lease claims (`POST /api/v1/agent/jobs/claim`).
   - Realtime WebSocket events serve purely as wake-up signals, never as direct execution commands.
2. **Strict Loopback Binding:**
   - Any local HTTP interface exposed by the agent (for diagnostic dashboards or system tray communication) is strictly bound to `127.0.0.1` / `localhost`.
   - Binding to `0.0.0.0` or any external network interface is treated as a critical security violation and immediately prevented by configuration validators.

## Consequences

### Positive
- Zero firewall or router configuration required by the shop owner during onboarding.
- Eliminates risk of remote unauthorized access to physical printers via the public internet.
- Works reliably on any standard internet-connected Windows PC.

### Negative / Trade-offs
- The agent must maintain a persistent WebSocket connection or poll if connection drops.
- Local diagnostics are accessible only on the shop PC itself, not from other machines on the LAN.
