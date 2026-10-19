import type {
  JobEvent,
  CreateJobEventDto,
  DocumentDeletionLog,
  CreateDocumentDeletionLogDto
} from './events.types.js';

export interface IJobEventsRepository {
  findById(id: number): Promise<JobEvent | null>;
  findByJobId(jobId: string): Promise<JobEvent[]>;
  create(dto: CreateJobEventDto): Promise<JobEvent>;
}

export interface IDocumentDeletionLogsRepository {
  findById(id: string): Promise<DocumentDeletionLog | null>;
  findByJobId(jobId: string): Promise<DocumentDeletionLog[]>;
  create(dto: CreateDocumentDeletionLogDto): Promise<DocumentDeletionLog>;
}

const FORBIDDEN_SENSITIVE_KEYS = [
  'document_data',
  'raw_document',
  'pdf_content',
  'payload_base64',
  'file_bytes',
  'password'
];

export class MockJobEventsRepository implements IJobEventsRepository {
  private events: JobEvent[] = [];
  private nextId = 1;

  async findById(id: number): Promise<JobEvent | null> {
    const event = this.events.find(e => e.id === id);
    return event ? { ...event } : null;
  }

  async findByJobId(jobId: string): Promise<JobEvent[]> {
    return this.events
      .filter(e => e.job_id === jobId)
      .map(e => ({ ...e }));
  }

  async create(dto: CreateJobEventDto): Promise<JobEvent> {
    const metadata = dto.metadata ?? {};

    // Privacy invariant check: metadata MUST NOT contain raw document binary, payload, or sensitive passwords
    for (const key of Object.keys(metadata)) {
      if (FORBIDDEN_SENSITIVE_KEYS.includes(key.toLowerCase())) {
        throw new Error(`Privacy violation: event metadata contains sensitive key '${key}'`);
      }
    }

    const event: JobEvent = {
      id: this.nextId++,
      job_id: dto.job_id,
      actor_type: dto.actor_type,
      to_status: dto.to_status,
      event_name: dto.event_name,
      metadata: { ...metadata },
      created_at: new Date().toISOString(),
      ...(dto.attempt_id !== undefined ? { attempt_id: dto.attempt_id } : {}),
      ...(dto.actor_id !== undefined ? { actor_id: dto.actor_id } : {}),
      ...(dto.from_status !== undefined ? { from_status: dto.from_status } : {})
    };

    this.events.push(event);
    return { ...event };
  }
}

export class MockDocumentDeletionLogsRepository implements IDocumentDeletionLogsRepository {
  private logs: Map<string, DocumentDeletionLog> = new Map();

  async findById(id: string): Promise<DocumentDeletionLog | null> {
    const log = this.logs.get(id);
    return log ? { ...log } : null;
  }

  async findByJobId(jobId: string): Promise<DocumentDeletionLog[]> {
    return Array.from(this.logs.values())
      .filter(l => l.job_id === jobId)
      .map(l => ({ ...l }));
  }

  async create(dto: CreateDocumentDeletionLogDto): Promise<DocumentDeletionLog> {
    const id = crypto.randomUUID();
    const log: DocumentDeletionLog = {
      id,
      job_id: dto.job_id,
      document_storage_key: dto.document_storage_key,
      deleted_by: dto.deleted_by,
      reason: dto.reason,
      deleted_at: new Date().toISOString()
    };

    this.logs.set(id, log);
    return { ...log };
  }
}
