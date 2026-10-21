/**
 * Printer Management Domain Types for CAPS Owner Dashboard.
 * Aligned with CAPS SRS Sections 4.2, 4.3 & Migration 002 (public.printers, public.agent_devices).
 */

export type PrinterRole = 'bw' | 'color' | 'large_format';

export type PrinterStatus = 'online' | 'offline' | 'busy' | 'error';

export interface DriverCapabilities {
  paper_sizes: Array<'a4' | 'a3' | 'legal' | string>;
  color_modes: Array<'bw' | 'color' | string>;
  duplex_supported: boolean;
  max_copies: number;
  dpi_options?: number[] | undefined;
  tray_count?: number | undefined;
}

export interface AgentDevice {
  id: string; // UUID primary key
  shop_id: string; // UUID foreign key
  device_name: string;
  device_fingerprint: string;
  agent_version: string;
  is_revoked: boolean;
  last_heartbeat_at: string;
}

export interface Printer {
  id: string; // UUID primary key
  shop_id: string; // UUID foreign key
  device_id: string | null; // UUID foreign key to agent_devices
  name: string;
  role: PrinterRole;
  status: PrinterStatus;
  is_default: boolean;
  capabilities: DriverCapabilities;
  created_at: string;
  updated_at: string;
  // Associated agent details when joined
  device?: AgentDevice | undefined;
}

export interface UpdatePrinterAssignmentInput {
  printer_id: string;
  shop_id: string;
  device_id: string | null;
  role?: PrinterRole | undefined;
  is_default?: boolean | undefined;
}

export interface UpdatePrinterCapabilitiesInput {
  printer_id: string;
  shop_id: string;
  capabilities: DriverCapabilities;
}

export interface CapabilityDifference {
  hasDifferences: boolean;
  changes: string[];
}
