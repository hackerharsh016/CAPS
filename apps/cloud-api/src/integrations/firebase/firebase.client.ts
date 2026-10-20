import crypto from 'node:crypto';
import type { IFirebaseClient, FcmMessage, FcmSendResult } from './firebase.types.js';

export type { IFirebaseClient, FcmMessage, FcmSendResult };

export interface MockFirebaseClientOptions {
  simulatedErrors?: Record<string, string> | undefined;
  transientFailuresBeforeSuccess?: number | undefined;
}

export class MockFirebaseClient implements IFirebaseClient {
  public dispatchedMessages: FcmMessage[] = [];
  public simulatedErrors: Map<string, string> = new Map();
  public transientFailuresRemaining = 0;
  public totalSendAttempts = 0;

  constructor(options: MockFirebaseClientOptions = {}) {
    if (options.simulatedErrors) {
      for (const [token, errCode] of Object.entries(options.simulatedErrors)) {
        this.simulatedErrors.set(token, errCode);
      }
    }
    this.transientFailuresRemaining = options.transientFailuresBeforeSuccess ?? 0;
  }

  setTokenError(token: string, errorCode: string): void {
    this.simulatedErrors.set(token, errorCode);
  }

  setTransientFailures(count: number): void {
    this.transientFailuresRemaining = count;
  }

  clear(): void {
    this.dispatchedMessages = [];
    this.simulatedErrors.clear();
    this.transientFailuresRemaining = 0;
    this.totalSendAttempts = 0;
  }

  async send(message: FcmMessage): Promise<FcmSendResult> {
    this.totalSendAttempts++;

    // 1. Check transient server failures
    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining--;
      return {
        success: false,
        errorCode: 'server-unavailable',
        errorMessage: 'Firebase Cloud Messaging backend temporarily unavailable'
      };
    }

    // 2. Check token-specific errors (e.g. revoked token)
    const errorForToken = this.simulatedErrors.get(message.token);
    if (errorForToken) {
      return {
        success: false,
        errorCode: errorForToken,
        errorMessage: `Simulated Firebase error: ${errorForToken}`
      };
    }

    // 3. Successful dispatch
    this.dispatchedMessages.push({ ...message });
    return {
      success: true,
      messageId: `projects/caps-cloud/messages/${crypto.randomUUID()}`
    };
  }

  async sendMulticast(messages: FcmMessage[]): Promise<FcmSendResult[]> {
    return Promise.all(messages.map(m => this.send(m)));
  }
}

export function createFirebaseClient(
  options: {
    useMock?: boolean | undefined;
    projectId?: string | undefined;
  } = {}
): IFirebaseClient {
  // Always use MockFirebaseClient in test mode or when external credentials are absent
  if (options.useMock || !options.projectId || process.env['NODE_ENV'] === 'test') {
    return new MockFirebaseClient();
  }

  // Contract-first fallback for live development environments without initialized Firebase Admin credentials
  return new MockFirebaseClient();
}
