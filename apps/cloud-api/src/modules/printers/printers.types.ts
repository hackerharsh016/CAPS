export type PrinterRole = 'bw' | 'color' | 'large_format';
export type PrinterStatus = 'online' | 'offline' | 'busy' | 'error';

export interface PrinterCapabilities {
  paper_sizes: string[];
  color_modes: string[];
  duplex_supported: boolean;
  max_copies: number;
}

export interface Printer {
  id: string; // UUID
  shop_id: string; // UUID referencing Shop
  device_id?: string | undefined; // UUID referencing AgentDevice
  name: string;
  role: PrinterRole;
  status: PrinterStatus;
  is_default: boolean;
  capabilities: PrinterCapabilities;
  created_at: string;
  updated_at?: string | undefined;
}

export interface CreatePrinterDto {
  shop_id: string;
  device_id?: string | undefined;
  name: string;
  role?: PrinterRole | undefined;
  status?: PrinterStatus | undefined;
  is_default?: boolean | undefined;
  capabilities?: PrinterCapabilities | undefined;
}

export interface UpdatePrinterDto {
  device_id?: string | undefined;
  name?: string | undefined;
  role?: PrinterRole | undefined;
  status?: PrinterStatus | undefined;
  is_default?: boolean | undefined;
  capabilities?: PrinterCapabilities | undefined;
}

export interface ListPrintersQuery {
  role?: PrinterRole | undefined;
  status?: PrinterStatus | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}
