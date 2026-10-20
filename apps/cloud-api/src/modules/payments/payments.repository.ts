import type { PaymentRecord, CreatePaymentDto, UpdatePaymentDto } from './payments.types.js';

export interface IPaymentsRepository {
  findById(id: string): Promise<PaymentRecord | null>;
  findByJobId(jobId: string): Promise<PaymentRecord[]>;
  findByGatewayRef(gatewayRef: string): Promise<PaymentRecord | null>;
  findAll(): Promise<PaymentRecord[]>;
  create(dto: CreatePaymentDto): Promise<PaymentRecord>;
  update(id: string, dto: UpdatePaymentDto): Promise<PaymentRecord | null>;
  delete(id: string): Promise<boolean>;
}

export class MockPaymentsRepository implements IPaymentsRepository {
  private payments: Map<string, PaymentRecord> = new Map();

  async findById(id: string): Promise<PaymentRecord | null> {
    const payment = this.payments.get(id);
    return payment ? { ...payment } : null;
  }

  async findByJobId(jobId: string): Promise<PaymentRecord[]> {
    return Array.from(this.payments.values())
      .filter(p => p.print_job_id === jobId)
      .map(p => ({ ...p }));
  }

  async findByGatewayRef(gatewayRef: string): Promise<PaymentRecord | null> {
    for (const payment of this.payments.values()) {
      if (payment.gateway_ref === gatewayRef) {
        return { ...payment };
      }
    }
    return null;
  }

  async findAll(): Promise<PaymentRecord[]> {
    return Array.from(this.payments.values()).map(p => ({ ...p }));
  }

  async create(dto: CreatePaymentDto): Promise<PaymentRecord> {
    // Replay protection: gateway_ref must be globally unique when present
    if (dto.gateway_ref) {
      const existing = await this.findByGatewayRef(dto.gateway_ref);
      if (existing) {
        throw new Error(
          `Duplicate payment gateway_ref '${dto.gateway_ref}' rejected (replay attack prevention).`
        );
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const payment: PaymentRecord = {
      id,
      print_job_id: dto.print_job_id,
      amount_paise: dto.amount_paise,
      currency: dto.currency ?? 'INR',
      method: dto.method,
      status: dto.status ?? 'initiated',
      created_at: now,
      updated_at: now,
      ...(dto.gateway_ref !== undefined ? { gateway_ref: dto.gateway_ref } : {})
    };

    this.payments.set(id, payment);
    return { ...payment };
  }

  async update(id: string, dto: UpdatePaymentDto): Promise<PaymentRecord | null> {
    const existing = this.payments.get(id);
    if (!existing) return null;

    if (dto.gateway_ref && dto.gateway_ref !== existing.gateway_ref) {
      const conflict = await this.findByGatewayRef(dto.gateway_ref);
      if (conflict && conflict.id !== id) {
        throw new Error(`Duplicate payment gateway_ref '${dto.gateway_ref}' rejected.`);
      }
    }

    const now = new Date().toISOString();
    const updated: PaymentRecord = {
      ...existing,
      status: dto.status ?? existing.status,
      method: dto.method ?? existing.method,
      amount_paise: dto.amount_paise ?? existing.amount_paise,
      gateway_ref: dto.gateway_ref !== undefined ? dto.gateway_ref : existing.gateway_ref,
      updated_at: now
    };

    this.payments.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.payments.delete(id);
  }
}
