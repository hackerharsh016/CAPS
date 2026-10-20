import crypto from 'node:crypto';
import type {
  UserFcmToken,
  RegisterTokenDto,
  NotificationOutboxEntry,
  CreateOutboxEntryDto,
  OutboxStatus
} from './notifications.types.js';

export interface IUserFcmTokensRepository {
  saveToken(dto: RegisterTokenDto): Promise<UserFcmToken>;
  findActiveByUserId(userId: string): Promise<UserFcmToken[]>;
  deactivateToken(deviceToken: string): Promise<boolean>;
  removeToken(userId: string, deviceToken: string): Promise<boolean>;
}

export interface INotificationOutboxRepository {
  create(dto: CreateOutboxEntryDto): Promise<NotificationOutboxEntry>;
  findByDedupeKey(dedupeKey: string): Promise<NotificationOutboxEntry | null>;
  updateStatus(
    id: string,
    status: OutboxStatus,
    details?: {
      last_error?: string | undefined;
      delivered_at?: string | undefined;
      attempts?: number | undefined;
    }
  ): Promise<NotificationOutboxEntry | null>;
  findByUserId(userId: string): Promise<NotificationOutboxEntry[]>;
}

export class MockUserFcmTokensRepository implements IUserFcmTokensRepository {
  private tokens: Map<string, UserFcmToken> = new Map(); // id -> token

  async saveToken(dto: RegisterTokenDto): Promise<UserFcmToken> {
    // If device_token already registered for this user, activate and refresh
    for (const [id, t] of this.tokens.entries()) {
      if (t.user_id === dto.user_id && t.device_token === dto.device_token) {
        const updated: UserFcmToken = {
          ...t,
          device_type: dto.device_type ?? t.device_type,
          is_active: true,
          last_used_at: new Date().toISOString()
        };
        this.tokens.set(id, updated);
        return { ...updated };
      }
    }

    const id = crypto.randomUUID();
    const token: UserFcmToken = {
      id,
      user_id: dto.user_id,
      device_token: dto.device_token,
      device_type: dto.device_type ?? 'web',
      is_active: true,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString()
    };
    this.tokens.set(id, token);
    return { ...token };
  }

  async findActiveByUserId(userId: string): Promise<UserFcmToken[]> {
    return Array.from(this.tokens.values())
      .filter(t => t.user_id === userId && t.is_active)
      .map(t => ({ ...t }));
  }

  async deactivateToken(deviceToken: string): Promise<boolean> {
    let modified = false;
    for (const [id, t] of this.tokens.entries()) {
      if (t.device_token === deviceToken && t.is_active) {
        this.tokens.set(id, { ...t, is_active: false });
        modified = true;
      }
    }
    return modified;
  }

  async removeToken(userId: string, deviceToken: string): Promise<boolean> {
    for (const [id, t] of this.tokens.entries()) {
      if (t.user_id === userId && t.device_token === deviceToken) {
        return this.tokens.delete(id);
      }
    }
    return false;
  }
}

export class MockNotificationOutboxRepository implements INotificationOutboxRepository {
  private entries: Map<string, NotificationOutboxEntry> = new Map(); // id -> entry

  async create(dto: CreateOutboxEntryDto): Promise<NotificationOutboxEntry> {
    const existing = await this.findByDedupeKey(dto.dedupe_key);
    if (existing) {
      return { ...existing };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const entry: NotificationOutboxEntry = {
      id,
      dedupe_key: dto.dedupe_key,
      job_id: dto.job_id,
      user_id: dto.user_id,
      event_type: dto.event_type,
      title: dto.title,
      body: dto.body,
      data: { ...dto.data },
      status: 'pending',
      attempts: 0,
      max_attempts: dto.max_attempts ?? 3,
      created_at: now,
      updated_at: now
    };

    this.entries.set(id, entry);
    return { ...entry };
  }

  async findByDedupeKey(dedupeKey: string): Promise<NotificationOutboxEntry | null> {
    for (const e of this.entries.values()) {
      if (e.dedupe_key === dedupeKey) {
        return { ...e };
      }
    }
    return null;
  }

  async updateStatus(
    id: string,
    status: OutboxStatus,
    details?: {
      last_error?: string | undefined;
      delivered_at?: string | undefined;
      attempts?: number | undefined;
    }
  ): Promise<NotificationOutboxEntry | null> {
    const existing = this.entries.get(id);
    if (!existing) return null;

    const updated: NotificationOutboxEntry = {
      ...existing,
      status,
      attempts: details?.attempts !== undefined ? details.attempts : existing.attempts,
      last_error: details?.last_error !== undefined ? details.last_error : existing.last_error,
      delivered_at:
        details?.delivered_at !== undefined ? details.delivered_at : existing.delivered_at,
      updated_at: new Date().toISOString()
    };

    this.entries.set(id, updated);
    return { ...updated };
  }

  async findByUserId(userId: string): Promise<NotificationOutboxEntry[]> {
    return Array.from(this.entries.values())
      .filter(e => e.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map(e => ({ ...e }));
  }
}
