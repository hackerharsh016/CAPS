/**
 * Printer hardware and capabilities domain types for CAPS.
 */

import { ColorMode, PaperSize } from './settings.js';

export type PrinterRole = 'bw' | 'color' | 'large_format';

export type PrinterStatus = 'online' | 'offline' | 'error';

export interface PrinterCapabilities {
  paper_sizes: PaperSize[];
  color_modes: ColorMode[];
  duplex_supported: boolean;
  max_copies: number;
}

export interface Printer {
  id: string; // UUID
  shop_id: string; // UUID references Shop
  name: string; // OS device name reported by driver (e.g. 'Canon LBP2900')
  role: PrinterRole;
  is_default: boolean;
  status: PrinterStatus;
  capabilities: PrinterCapabilities;
  created_at: string;
  updated_at?: string;
}
