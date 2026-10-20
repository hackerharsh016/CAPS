import crypto from 'node:crypto';
import type {
  Printer,
  CreatePrinterDto,
  UpdatePrinterDto,
  PrinterRole,
  PrinterStatus
} from './printers.types.js';

export interface PrinterQueryFilter {
  role?: PrinterRole | undefined;
  status?: PrinterStatus | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export interface IPrintersRepository {
  findById(id: string): Promise<Printer | null>;
  findByShopId(
    shopId: string,
    filter?: PrinterQueryFilter
  ): Promise<{ printers: Printer[]; total: number } & Printer[]>;
  findDefaultByShopId(shopId: string): Promise<Printer | null>;
  create(dto: CreatePrinterDto): Promise<Printer>;
  update(id: string, dto: UpdatePrinterDto): Promise<Printer | null>;
  delete(id: string): Promise<boolean>;
}

export class MockPrintersRepository implements IPrintersRepository {
  private printers: Map<string, Printer> = new Map();

  async findById(id: string): Promise<Printer | null> {
    const printer = this.printers.get(id);
    return printer ? { ...printer } : null;
  }

  async findByShopId(
    shopId: string,
    filter: PrinterQueryFilter = {}
  ): Promise<{ printers: Printer[]; total: number } & Printer[]> {
    let all = Array.from(this.printers.values()).filter(p => p.shop_id === shopId);

    if (filter.role) {
      all = all.filter(p => p.role === filter.role);
    }

    if (filter.status) {
      all = all.filter(p => p.status === filter.status);
    }

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? (Object.keys(filter).length === 0 ? all.length : 10);

    const paged = all.slice(offset, offset + limit).map(p => ({ ...p }));
    return Object.assign(paged, { printers: paged, total }) as {
      printers: Printer[];
      total: number;
    } & Printer[];
  }

  async findDefaultByShopId(shopId: string): Promise<Printer | null> {
    const printer = Array.from(this.printers.values()).find(
      p => p.shop_id === shopId && p.is_default
    );
    return printer ? { ...printer } : null;
  }

  async create(dto: CreatePrinterDto): Promise<Printer> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // If marked default, unset default on other printers for same shop
    if (dto.is_default) {
      for (const [key, p] of this.printers.entries()) {
        if (p.shop_id === dto.shop_id && p.is_default) {
          this.printers.set(key, { ...p, is_default: false, updated_at: now });
        }
      }
    }

    const defaultCapabilities = {
      paper_sizes: ['a4'],
      color_modes: ['bw'],
      duplex_supported: false,
      max_copies: 99
    };

    const printer: Printer = {
      id,
      shop_id: dto.shop_id,
      name: dto.name,
      role: dto.role ?? 'bw',
      status: dto.status ?? 'offline',
      is_default: dto.is_default ?? false,
      capabilities: dto.capabilities ?? defaultCapabilities,
      created_at: now,
      updated_at: now,
      ...(dto.device_id !== undefined ? { device_id: dto.device_id } : {})
    };

    this.printers.set(id, printer);
    return { ...printer };
  }

  async update(id: string, dto: UpdatePrinterDto): Promise<Printer | null> {
    const existing = this.printers.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    if (dto.is_default) {
      for (const [key, p] of this.printers.entries()) {
        if (p.shop_id === existing.shop_id && p.id !== id && p.is_default) {
          this.printers.set(key, { ...p, is_default: false, updated_at: now });
        }
      }
    }

    const updated: Printer = {
      ...existing,
      name: dto.name !== undefined ? dto.name : existing.name,
      role: dto.role !== undefined ? dto.role : existing.role,
      status: dto.status !== undefined ? dto.status : existing.status,
      is_default: dto.is_default !== undefined ? dto.is_default : existing.is_default,
      capabilities: dto.capabilities !== undefined ? dto.capabilities : existing.capabilities,
      device_id: dto.device_id !== undefined ? dto.device_id : existing.device_id,
      updated_at: now
    };

    this.printers.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.printers.delete(id);
  }

  clear(): void {
    this.printers.clear();
  }
}
