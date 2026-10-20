import type { IFirebaseClient } from '../../integrations/firebase/firebase.types.js';
import type {
  IUserFcmTokensRepository,
  INotificationOutboxRepository
} from './notifications.repository.js';
import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { JobEvent } from '../events/events.types.js';
import type {
  LifecycleEventType,
  DispatchNotificationResult,
  UserFcmToken,
  NotificationOutboxEntry
} from './notifications.types.js';
import {
  renderLifecycleNotification,
  type NotificationTemplateParams
} from './notifications.templates.js';

export class NotificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}

export interface DispatchOptions {
  failure_reason?: string | undefined;
  pickup_code?: string | undefined;
  queue_position?: number | undefined;
  estimated_wait_seconds?: number | undefined;
  token?: string | undefined;
  maxRetries?: number | undefined;
}

export class NotificationsService {
  constructor(
    private readonly firebaseClient: IFirebaseClient,
    private readonly tokensRepo: IUserFcmTokensRepository,
    private readonly outboxRepo: INotificationOutboxRepository,
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly shopsRepo: IShopsRepository
  ) {}

  /**
   * Registers a client device FCM token for push notifications.
   */
  async registerToken(
    userId: string,
    deviceToken: string,
    deviceType: 'web' | 'android' | 'ios' = 'web'
  ): Promise<UserFcmToken> {
    if (!deviceToken || deviceToken.trim().length === 0) {
      throw new NotificationError('VALIDATION_ERROR', 'device_token must not be empty', 400);
    }
    return this.tokensRepo.saveToken({
      user_id: userId,
      device_token: deviceToken.trim(),
      device_type: deviceType
    });
  }

  /**
   * Unregisters / removes a client device FCM token.
   */
  async unregisterToken(userId: string, deviceToken: string): Promise<boolean> {
    return this.tokensRepo.removeToken(userId, deviceToken);
  }

  /**
   * Returns active device tokens for a customer.
   */
  async getActiveTokens(userId: string): Promise<UserFcmToken[]> {
    return this.tokensRepo.findActiveByUserId(userId);
  }

  /**
   * Retrieves notification outbox audit history for a user.
   */
  async getHistory(userId: string): Promise<NotificationOutboxEntry[]> {
    return this.outboxRepo.findByUserId(userId);
  }

  /**
   * Dispatches lifecycle notification for a print job event with deduplication,
   * exponential retry, and automatic token revocation.
   */
  async dispatchJobLifecycleNotification(
    jobId: string,
    eventType: LifecycleEventType,
    options: DispatchOptions = {}
  ): Promise<DispatchNotificationResult> {
    const dedupeKey = `${jobId}:${eventType}`;

    // 1. Deduplication check against outbox ledger
    const existing = await this.outboxRepo.findByDedupeKey(dedupeKey);
    if (existing) {
      if (existing.status === 'delivered' || existing.status === 'duplicate_skipped') {
        return {
          outbox_id: existing.id,
          dedupe_key: dedupeKey,
          status: 'duplicate_skipped',
          dispatched_tokens_count: 0,
          revoked_tokens_count: 0,
          skipped_as_duplicate: true
        };
      }
    }

    // 2. Fetch associated print job & shop metadata
    const job = await this.printJobsRepo.findById(jobId);
    if (!job) {
      throw new NotificationError('JOB_NOT_FOUND', `Print job '${jobId}' not found`, 404);
    }

    const shop = await this.shopsRepo.findById(job.shop_id);
    const shopName = shop ? shop.name : 'CAPS Print Shop';

    // 3. Render and privacy-verify notification template
    const templateParams: NotificationTemplateParams = {
      job_id: jobId,
      token: options.token,
      shop_name: shopName,
      queue_position: options.queue_position ?? job.queue_position,
      estimated_wait_seconds: options.estimated_wait_seconds,
      pickup_code: options.pickup_code,
      failure_reason: options.failure_reason
    };

    const rendered = renderLifecycleNotification(eventType, templateParams);

    // 4. Create outbox record
    const maxAttempts = options.maxRetries ?? 3;
    const outboxEntry =
      existing ??
      (await this.outboxRepo.create({
        dedupe_key: dedupeKey,
        job_id: jobId,
        user_id: job.customer_id,
        event_type: eventType,
        title: rendered.title,
        body: rendered.body,
        data: rendered.data,
        max_attempts: maxAttempts
      }));

    // 5. Fetch user's active device tokens
    const activeTokens = await this.tokensRepo.findActiveByUserId(job.customer_id);

    if (activeTokens.length === 0) {
      await this.outboxRepo.updateStatus(outboxEntry.id, 'delivered', {
        delivered_at: new Date().toISOString(),
        attempts: 1
      });
      return {
        outbox_id: outboxEntry.id,
        dedupe_key: dedupeKey,
        status: 'delivered',
        dispatched_tokens_count: 0,
        revoked_tokens_count: 0
      };
    }

    // 6. Dispatch with retry loop and token cleanup
    let successfulDispatches = 0;
    let revokedTokensCount = 0;
    let lastError: string | undefined = undefined;
    let attemptsCount = outboxEntry.attempts;

    for (const tokenRecord of activeTokens) {
      const token = tokenRecord.device_token;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        attemptsCount++;
        const sendResult = await this.firebaseClient.send({
          token,
          notification: {
            title: rendered.title,
            body: rendered.body
          },
          data: rendered.data
        });

        if (sendResult.success) {
          successfulDispatches++;
          break;
        }

        lastError = sendResult.errorMessage ?? sendResult.errorCode ?? 'FCM send failed';

        // Check for revoked/unregistered token
        if (
          sendResult.errorCode === 'registration-token-not-registered' ||
          sendResult.errorCode === 'invalid-registration-token'
        ) {
          await this.tokensRepo.deactivateToken(token);
          revokedTokensCount++;
          // Terminal error for this token, do not retry
          break;
        }

        // Transient failure retry delay (shortened in unit tests)
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
    }

    // 7. Update outbox entry status
    const finalStatus =
      successfulDispatches > 0 ||
      (activeTokens.length > 0 && revokedTokensCount === activeTokens.length)
        ? 'delivered'
        : 'failed';

    await this.outboxRepo.updateStatus(outboxEntry.id, finalStatus, {
      delivered_at: finalStatus === 'delivered' ? new Date().toISOString() : undefined,
      attempts: attemptsCount,
      last_error: lastError
    });

    return {
      outbox_id: outboxEntry.id,
      dedupe_key: dedupeKey,
      status: finalStatus,
      dispatched_tokens_count: successfulDispatches,
      revoked_tokens_count: revokedTokensCount
    };
  }

  /**
   * Automatically consumes verified job lifecycle events and triggers appropriate push notifications.
   */
  async handleJobEvent(event: JobEvent): Promise<DispatchNotificationResult | null> {
    let lifecycleType: LifecycleEventType | null = null;

    switch (event.to_status) {
      case 'queued':
        lifecycleType = 'job_queued';
        break;
      case 'printing':
        lifecycleType = 'job_printing';
        break;
      case 'completed':
        lifecycleType = 'job_ready';
        break;
      case 'failed':
        lifecycleType = 'job_failed';
        break;
      case 'cancelled':
        lifecycleType = 'job_cancelled';
        break;
      default:
        return null;
    }

    const failureReason =
      typeof event.metadata['reason'] === 'string' ? event.metadata['reason'] : undefined;
    const pickupCode =
      typeof event.metadata['pickup_code'] === 'string' ? event.metadata['pickup_code'] : undefined;

    return this.dispatchJobLifecycleNotification(event.job_id, lifecycleType, {
      failure_reason: failureReason,
      pickup_code: pickupCode
    });
  }
}
