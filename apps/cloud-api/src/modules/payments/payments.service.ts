import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IPaymentsRepository } from './payments.repository.js';
import type { IRazorpayClient } from './razorpay.service.js';
import type { IJobEventsRepository } from '../events/events.repository.js';
import type { CreateOrderRequestDto, CreateOrderResponseDto } from './payments.types.js';

export class PaymentError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly code = 'PAYMENT_ERROR') {
    super(message);
    this.name = 'PaymentError';
  }
}

export class NotFoundError extends PaymentError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class AmountTamperingError extends PaymentError {
  constructor(message = 'Amount tampering detected') {
    super(message, 400, 'AMOUNT_TAMPERING_DETECTED');
    this.name = 'AmountTamperingError';
  }
}

export class InvalidJobStateError extends PaymentError {
  constructor(message = 'Invalid job state for payment') {
    super(message, 400, 'INVALID_JOB_STATE');
    this.name = 'InvalidJobStateError';
  }
}

export class PaymentsService {
  constructor(
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly paymentsRepo: IPaymentsRepository,
    private readonly razorpayClient: IRazorpayClient,
    private readonly jobEventsRepo?: IJobEventsRepository | undefined
  ) {}

  /**
   * Creates a Razorpay order for an existing pending print job.
   *
   * SECURITY INVARIANTS:
   * 1. The client NEVER dictates the charged amount. The amount is strictly derived from
   *    the authoritative server-side snapshot in `print_jobs.price_total_paise`.
   * 2. If the client supplies an amount that does not match `price_total_paise`, the request
   *    is strictly rejected with an AmountTamperingError.
   * 3. Only jobs in `pending_payment` status can have payment orders created.
   * 4. Razorpay key secret is never exposed; only public key_id and order_id are returned.
   */
  async createRazorpayOrder(dto: CreateOrderRequestDto): Promise<CreateOrderResponseDto> {
    // 1. Authoritative print job lookup
    const job = await this.printJobsRepo.findById(dto.print_job_id);
    if (!job) {
      throw new NotFoundError(`Print job '${dto.print_job_id}' not found.`);
    }

    // 2. State verification
    if (job.status !== 'pending_payment') {
      throw new InvalidJobStateError(
        `Cannot create payment order for job '${job.id}' in status '${job.status}'. Only 'pending_payment' jobs can be paid.`
      );
    }

    // 3. Amount tampering denial
    const authoritativeAmountPaise = job.price_total_paise;
    if (authoritativeAmountPaise <= 0) {
      throw new PaymentError('Print job total price must be greater than zero.', 400, 'INVALID_PRICE');
    }

    if (
      dto.requested_amount_paise !== undefined &&
      dto.requested_amount_paise !== authoritativeAmountPaise
    ) {
      throw new AmountTamperingError(
        `Amount tampering detected: client requested ${dto.requested_amount_paise} paise, but authoritative quote is ${authoritativeAmountPaise} paise.`
      );
    }

    // 4. Idempotency check: see if an initiated order already exists for this job
    const existingPayments = await this.paymentsRepo.findByJobId(job.id);
    const existingInitiated = existingPayments.find(
      p => p.status === 'initiated' && p.gateway_ref?.startsWith('order_')
    );

    if (existingInitiated && existingInitiated.gateway_ref) {
      const existingOrder = await this.razorpayClient.getOrder(existingInitiated.gateway_ref);
      if (existingOrder && existingOrder.status === 'created') {
        return {
          order_id: existingOrder.id,
          amount_paise: existingOrder.amount,
          currency: 'INR',
          key_id: this.razorpayClient.getKeyId(),
          print_job_id: job.id,
          status: 'initiated',
          receipt: existingOrder.receipt
        };
      }
    }

    // 5. Generate receipt identifier and order notes
    const sanitizedJobToken = job.id.replace(/-/g, '').substring(0, 16);
    const receipt = `rcpt_${sanitizedJobToken}`;
    const notes: Record<string, string> = {
      job_id: job.id,
      shop_id: job.shop_id,
      ...(dto.notes !== undefined ? dto.notes : {})
    };

    // 6. Invoke Razorpay API (or local mock in test mode)
    const order = await this.razorpayClient.createOrder({
      amount_paise: authoritativeAmountPaise,
      currency: 'INR',
      receipt,
      notes
    });

    // 7. Persist payment record
    await this.paymentsRepo.create({
      print_job_id: job.id,
      amount_paise: authoritativeAmountPaise,
      currency: 'INR',
      method: 'upi',
      gateway_ref: order.id,
      status: 'initiated'
    });

    // 8. Append audit event
    if (this.jobEventsRepo) {
      await this.jobEventsRepo.create({
        job_id: job.id,
        actor_type: 'customer',
        from_status: 'pending_payment',
        to_status: 'pending_payment',
        event_name: 'payment_order_created',
        metadata: {
          order_id: order.id,
          amount_paise: authoritativeAmountPaise,
          currency: 'INR'
        }
      });
    }

    return {
      order_id: order.id,
      amount_paise: authoritativeAmountPaise,
      currency: 'INR',
      key_id: this.razorpayClient.getKeyId(),
      print_job_id: job.id,
      status: 'initiated',
      receipt: order.receipt
    };
  }
}
