import type { LifecycleEventType } from './notifications.types.js';

export interface NotificationTemplateParams {
  job_id: string;
  token?: string | undefined; // Short friendly token / first 8 chars of job_id
  shop_name: string;
  queue_position?: number | undefined;
  estimated_wait_seconds?: number | undefined;
  pickup_code?: string | undefined;
  failure_reason?: string | undefined;
}

export interface RenderedNotification {
  title: string;
  body: string;
  data: Record<string, string>;
}

const SENSITIVE_CONTENT_PATTERNS = [
  /document_storage_key/i,
  /raw_document/i,
  /pdf_content/i,
  /file_bytes/i,
  /payload_base64/i,
  /storage\/v1\/object/i,
  /%PDF-/i,
  /JVBERi0/i // base64 encoded %PDF-
];

/**
 * Asserts privacy invariant: notifications must never leak document contents or sensitive storage keys.
 */
export function validateNoDocumentContent(rendered: RenderedNotification): void {
  const allText = [
    rendered.title,
    rendered.body,
    ...Object.keys(rendered.data),
    ...Object.values(rendered.data)
  ].join(' ');

  for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
    if (pattern.test(allText)) {
      throw new Error(
        `Privacy policy violation: Notification payload matches sensitive pattern ${pattern.toString()}`
      );
    }
  }
}

/**
 * Renders verified notification templates based on job lifecycle transitions.
 */
export function renderLifecycleNotification(
  eventType: LifecycleEventType,
  params: NotificationTemplateParams
): RenderedNotification {
  const shortToken = params.token ?? params.job_id.slice(0, 8).toUpperCase();
  const shopName = params.shop_name;

  let title = '';
  let body = '';
  const data: Record<string, string> = {
    job_id: params.job_id,
    token: shortToken,
    shop_name: shopName,
    event_type: eventType,
    timestamp: new Date().toISOString()
  };

  switch (eventType) {
    case 'job_queued': {
      title = 'Order Confirmed & Queued';
      const posStr = params.queue_position ? ` Position: #${params.queue_position}.` : '';
      const etaMinutes =
        typeof params.estimated_wait_seconds === 'number'
          ? Math.max(1, Math.round(params.estimated_wait_seconds / 60))
          : null;
      const etaStr = etaMinutes ? ` Est. wait: ~${etaMinutes} min.` : '';
      body = `Your print job #${shortToken} is queued at ${shopName}.${posStr}${etaStr}`;
      if (params.queue_position !== undefined) {
        data['queue_position'] = String(params.queue_position);
      }
      break;
    }

    case 'job_printing': {
      title = 'Printing in Progress';
      body = `Your print job #${shortToken} is currently printing on the machine at ${shopName}.`;
      break;
    }

    case 'job_ready': {
      const code = params.pickup_code ?? shortToken.slice(-4);
      title = 'Prints Ready for Pickup!';
      body = `Order #${shortToken} is complete! Collect your prints at ${shopName}. Pickup code: ${code}.`;
      data['pickup_code'] = code;
      break;
    }

    case 'job_failed': {
      title = 'Print Job Attention Required';
      const reasonStr = params.failure_reason ? ` (${params.failure_reason})` : '';
      body = `An issue occurred with print job #${shortToken} at ${shopName}${reasonStr}. The operator has been alerted.`;
      break;
    }

    case 'job_cancelled': {
      title = 'Print Job Cancelled';
      body = `Order #${shortToken} was cancelled. Any payment holds will be released per policy.`;
      break;
    }
  }

  const rendered: RenderedNotification = { title, body, data };
  validateNoDocumentContent(rendered);
  return rendered;
}
