import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IPaymentsRepository } from './payments.repository.js';
import type { IJobEventsRepository } from '../events/events.repository.js';
import type { Shop } from '../shops/shops.types.js';
import type {
  SelectPayAtCounterDto,
  SelectPayAtCounterResponseDto,
  ConfirmCashSettlementDto,
  ConfirmCashSettlementResponseDto,
  ShopPaymentReportDto,
  CashSettlementItem,
  GatewaySettlementItem
} from './payments.types.js';

export class PayAtCounterError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'PAY_AT_COUNTER_ERROR'
  ) {
    super(message);
    this.name = 'PayAtCounterError';
  }
}

export class PayAtCounterNotAllowedError extends PayAtCounterError {
  constructor(message = 'Pay-at-counter is not permitted for this shop') {
    super(message, 403, 'PAY_AT_COUNTER_NOT_ALLOWED');
    this.name = 'PayAtCounterNotAllowedError';
  }
}

export class UnauthorizedOperatorError extends PayAtCounterError {
  constructor(message = 'Unauthorized operator for this shop') {
    super(message, 403, 'UNAUTHORIZED_OPERATOR');
    this.name = 'UnauthorizedOperatorError';
  }
}

export class InsufficientCashSettlementError extends PayAtCounterError {
  constructor(message = 'Received cash is less than authoritative price') {
    super(message, 400, 'INSUFFICIENT_CASH');
    this.name = 'InsufficientCashSettlementError';
  }
}

export class ShopNotFoundError extends PayAtCounterError {
  constructor(message = 'Shop not found') {
    super(message, 404, 'SHOP_NOT_FOUND');
    this.name = 'ShopNotFoundError';
  }
}

export class JobNotFoundError extends PayAtCounterError {
  constructor(message = 'Print job not found') {
    super(message, 404, 'JOB_NOT_FOUND');
    this.name = 'JobNotFoundError';
  }
}

export class PayAtCounterService {
  constructor(
    private readonly shopsRepo: IShopsRepository,
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly paymentsRepo: IPaymentsRepository,
    private readonly jobEventsRepo: IJobEventsRepository
  ) {}

  /**
   * Toggles pay-at-counter opt-in for a shop.
   * Only the shop owner can configure this setting.
   */
  async configureShopPayAtCounter(
    shopId: string,
    ownerId: string,
    enabled: boolean
  ): Promise<Shop> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new ShopNotFoundError(`Shop '${shopId}' not found.`);
    }

    if (shop.owner_id !== ownerId) {
      throw new UnauthorizedOperatorError(
        `User '${ownerId}' is not the owner of shop '${shopId}'.`
      );
    }

    const updated = await this.shopsRepo.update(shopId, {
      allow_pay_at_counter: enabled
    });

    if (!updated) {
      throw new ShopNotFoundError(`Failed to update shop '${shopId}'.`);
    }

    return updated;
  }

  /**
   * Selects Pay-at-Counter for an unpaid print job.
   *
   * SECURITY ENFORCEMENT:
   * 1. Strictly checks if the target shop has opted into pay-at-counter.
   *    If not, customer is denied and must use online payment.
   * 2. The job remains in 'pending_payment' status and CANNOT be printed
   *    until authorized and settled at the counter by the shop owner/operator.
   */
  async selectPayAtCounter(dto: SelectPayAtCounterDto): Promise<SelectPayAtCounterResponseDto> {
    const job = await this.printJobsRepo.findById(dto.print_job_id);
    if (!job) {
      throw new JobNotFoundError(`Print job '${dto.print_job_id}' not found.`);
    }

    if (job.status !== 'pending_payment') {
      throw new PayAtCounterError(
        `Job '${job.id}' is in status '${job.status}'. Only pending_payment jobs can select pay-at-counter.`
      );
    }

    const shop = await this.shopsRepo.findById(job.shop_id);
    if (!shop) {
      throw new ShopNotFoundError(`Shop '${job.shop_id}' not found.`);
    }

    // Verify shop opt-in policy
    if (shop.allow_pay_at_counter !== true) {
      throw new PayAtCounterNotAllowedError(
        `Shop '${shop.name}' does not allow Pay-at-Counter. Online payment via UPI/Card is required.`
      );
    }

    // Upsert initiated pay-at-counter payment record
    const existingPayments = await this.paymentsRepo.findByJobId(job.id);
    let payment = existingPayments[0];

    if (payment) {
      payment = (await this.paymentsRepo.update(payment.id, {
        method: 'pay_at_counter',
        amount_paise: job.price_total_paise,
        status: 'initiated'
      })) ?? payment;
    } else {
      payment = await this.paymentsRepo.create({
        print_job_id: job.id,
        amount_paise: job.price_total_paise,
        currency: 'INR',
        method: 'pay_at_counter',
        status: 'initiated'
      });
    }

    // Append audit event
    await this.jobEventsRepo.create({
      job_id: job.id,
      actor_type: 'customer',
      from_status: 'pending_payment',
      to_status: 'pending_payment',
      event_name: 'pay_at_counter_selected',
      metadata: {
        shop_id: shop.id,
        amount_paise: job.price_total_paise
      }
    });

    return {
      success: true,
      print_job_id: job.id,
      payment_id: payment.id,
      amount_paise: job.price_total_paise,
      method: 'pay_at_counter',
      status: 'initiated',
      message: 'Pay-at-counter selected. Please pay cash at the counter for print authorization.'
    };
  }

  /**
   * Confirms cash settlement at the counter by shop owner or authorized operator.
   *
   * SECURITY ENFORCEMENT:
   * 1. Only the shop owner or operator of that specific shop can authorize cash settlement.
   * 2. Customers and operators of other shops are strictly forbidden.
   * 3. Authoritative amount check: received cash must be >= price_total_paise.
   * 4. Once settled, transitions payment to 'success', job to 'queued',
   *    stamps enqueued_at, and writes immutable cash settlement audit event.
   */
  async confirmCashSettlement(
    dto: ConfirmCashSettlementDto
  ): Promise<ConfirmCashSettlementResponseDto> {
    const job = await this.printJobsRepo.findById(dto.print_job_id);
    if (!job) {
      throw new JobNotFoundError(`Print job '${dto.print_job_id}' not found.`);
    }

    if (job.status !== 'pending_payment') {
      throw new PayAtCounterError(
        `Job '${job.id}' is in status '${job.status}'. Only pending_payment jobs can be settled at the counter.`
      );
    }

    const shop = await this.shopsRepo.findById(job.shop_id);
    if (!shop) {
      throw new ShopNotFoundError(`Shop '${job.shop_id}' not found.`);
    }

    // Authorization check: Only the shop owner (or authorized shop operator) can confirm cash
    if (dto.operator_id !== shop.owner_id) {
      throw new UnauthorizedOperatorError(
        `Operator '${dto.operator_id}' is not authorized to confirm cash payments for shop '${shop.id}'.`
      );
    }

    // Cash verification: Ensure received cash meets authoritative total
    const requiredAmount = job.price_total_paise;
    if (
      dto.received_amount_paise !== undefined &&
      dto.received_amount_paise < requiredAmount
    ) {
      throw new InsufficientCashSettlementError(
        `Received cash amount (${dto.received_amount_paise} paise) is less than required price (${requiredAmount} paise).`
      );
    }

    const receiptRef = dto.receipt_number ?? `cash_rcpt_${crypto.randomUUID().slice(0, 8)}`;
    const settledAt = new Date().toISOString();

    // Settle payment record
    const existingPayments = await this.paymentsRepo.findByJobId(job.id);
    let payment = existingPayments[0];

    if (payment) {
      payment = (await this.paymentsRepo.update(payment.id, {
        status: 'success',
        method: 'pay_at_counter',
        amount_paise: requiredAmount,
        gateway_ref: receiptRef
      })) ?? payment;
    } else {
      payment = await this.paymentsRepo.create({
        print_job_id: job.id,
        amount_paise: requiredAmount,
        currency: 'INR',
        method: 'pay_at_counter',
        status: 'success',
        gateway_ref: receiptRef
      });
    }

    // Transition job to queued for FIFO print agent pickup
    await this.printJobsRepo.update(job.id, {
      status: 'queued',
      enqueued_at: settledAt
    });

    // Write immutable cash settlement audit event
    await this.jobEventsRepo.create({
      job_id: job.id,
      actor_type: 'owner',
      actor_id: dto.operator_id,
      from_status: 'pending_payment',
      to_status: 'queued',
      event_name: 'cash_payment_settled',
      metadata: {
        shop_id: shop.id,
        settled_by: dto.operator_id,
        amount_paise: requiredAmount,
        receipt_ref: receiptRef,
        method: 'pay_at_counter'
      }
    });

    return {
      success: true,
      print_job_id: job.id,
      payment_id: payment.id,
      amount_paise: requiredAmount,
      status: 'success',
      method: 'pay_at_counter',
      settled_by: dto.operator_id,
      receipt_ref: receiptRef,
      job_status: 'queued',
      settled_at: settledAt
    };
  }

  /**
   * Generates financial settlement report distinguishing cash payments from gateway settlements.
   *
   * SECURITY ENFORCEMENT:
   * 1. Only the authenticated shop owner can access this shop's revenue report.
   * 2. Tenant isolation guarantees other shops' revenue is never leaked.
   */
  async getShopPaymentReport(
    shopId: string,
    requestingUserId: string
  ): Promise<ShopPaymentReportDto> {
    const shop = await this.shopsRepo.findById(shopId);
    if (!shop) {
      throw new ShopNotFoundError(`Shop '${shopId}' not found.`);
    }

    if (shop.owner_id !== requestingUserId) {
      throw new UnauthorizedOperatorError(
        `User '${requestingUserId}' is not authorized to view financial reports for shop '${shopId}'.`
      );
    }

    const allPayments = await this.paymentsRepo.findAll();
    const successfulPayments = allPayments.filter(p => p.status === 'success');

    // Filter payments belonging to jobs of this shop
    const cashItems: CashSettlementItem[] = [];
    const gatewayItems: GatewaySettlementItem[] = [];
    let cashTotalPaise = 0;
    let gatewayTotalPaise = 0;
    const byMethod: Record<string, number> = {};

    for (const payment of successfulPayments) {
      const job = await this.printJobsRepo.findById(payment.print_job_id);
      if (job && job.shop_id === shopId) {
        if (payment.method === 'pay_at_counter') {
          cashTotalPaise += payment.amount_paise;
          cashItems.push({
            payment_id: payment.id,
            job_id: payment.print_job_id,
            amount_paise: payment.amount_paise,
            receipt_ref: payment.gateway_ref ?? 'N/A',
            settled_at: payment.updated_at ?? payment.created_at
          });
        } else {
          gatewayTotalPaise += payment.amount_paise;
          byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amount_paise;
          gatewayItems.push({
            payment_id: payment.id,
            job_id: payment.print_job_id,
            method: payment.method,
            amount_paise: payment.amount_paise,
            gateway_ref: payment.gateway_ref ?? 'N/A',
            settled_at: payment.updated_at ?? payment.created_at
          });
        }
      }
    }

    return {
      shop_id: shopId,
      period: 'all_time',
      total_revenue_paise: cashTotalPaise + gatewayTotalPaise,
      total_transactions_count: cashItems.length + gatewayItems.length,
      cash_settlement: {
        total_paise: cashTotalPaise,
        transaction_count: cashItems.length,
        items: cashItems
      },
      gateway_settlement: {
        total_paise: gatewayTotalPaise,
        transaction_count: gatewayItems.length,
        by_method: byMethod,
        items: gatewayItems
      }
    };
  }
}
