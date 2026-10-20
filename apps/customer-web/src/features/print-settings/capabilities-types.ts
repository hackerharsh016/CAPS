/**
 * Printer hardware and shop capability domain types for CAPS Customer Web (P04-M04-F02).
 * Strictly mirrors @caps/types/printers contracts while maintaining full exactOptionalPropertyTypes compliance.
 */

import type { PaperSize, ColorMode } from './types';

export type PrinterRole = 'bw' | 'color' | 'large_format';

export type PrinterStatus = 'online' | 'offline' | 'error';

export interface DiscoveredPrinterCapabilities {
  paper_sizes: PaperSize[];
  color_modes: ColorMode[];
  duplex_supported: boolean;
  max_copies: number;
}

export interface DiscoveredPrinter {
  id: string; // UUID
  shop_id: string; // UUID
  name: string; // Device name (e.g. 'Canon imageRUNNER 2520')
  role: PrinterRole;
  is_default: boolean;
  status: PrinterStatus;
  capabilities: DiscoveredPrinterCapabilities;
  created_at: string;
  updated_at?: string | undefined;
}

export interface ShopPrinterCapabilities {
  shop_id: string;
  /** Union of all paper sizes supported by online printers in this shop */
  supported_paper_sizes: PaperSize[];
  /** Union of all color modes supported by online printers in this shop */
  supported_color_modes: ColorMode[];
  /** True if at least one online printer supports duplex */
  duplex_supported: boolean;
  /** Maximum copy limit across online printers */
  max_copies: number;
  /** Active online printers count */
  online_printers_count: number;
  /** Total registered printers count */
  total_printers_count: number;
  /** List of printers associated with this shop */
  printers: DiscoveredPrinter[];
  /** Timestamp when capabilities were last synchronized with the shop agent */
  last_synced_at: string;
  /** Whether the capability data is considered stale */
  is_stale: boolean;
  /** Error or offline notice if applicable */
  status_notice?: string | undefined;
}

export interface IncompatibilityItem {
  field: 'paper_size' | 'color_mode' | 'sides' | 'copies';
  settingValue: string;
  reason: string;
  suggestedValue: string;
}

export interface CapabilityCheckResult {
  isCompatible: boolean;
  incompatibilities: IncompatibilityItem[];
  warnings: string[];
  isStale: boolean;
}
