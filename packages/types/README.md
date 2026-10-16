# @caps/types

Shared TypeScript domain interfaces and enums for the CAPS monorepo.

## Modules

- `users.ts`: Roles (`customer`, `shop_owner`, `admin`) and profile definitions.
- `settings.ts`: Core print options (`PaperSize`, `ColorMode`, `SideMode`, `Orientation`, `BindingType`, `PrintSettings`).
- `pricing.ts`: Price breakdown models in integer paise, quote requests, and surcharge configs.
- `shops.ts`: Shop establishment and discovery schemas.
- `printers.ts`: Physical printer capabilities, roles, and device states.
- `jobs.ts`: Two-tier queue priority (`urgent` vs `flexible`) and job lifecycle states.
- `payments.ts`: Payment methods and transaction tracking.
- `agent.ts`: Print agent device pairing, leases, and attempt status reporting.
