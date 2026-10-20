export interface AgentHeartbeatPayload {
  agent_id: string;
  shop_id: string;
  version: string;
  status: 'online' | 'printing' | 'idle' | 'offline' | 'error';
  printers?:
    | Array<{
        printer_id: string;
        name: string;
        status: 'online' | 'offline' | 'paper_jam' | 'out_of_paper' | 'error';
      }>
    | undefined;
  system_info?:
    | {
        hostname?: string | undefined;
        os?: string | undefined;
        cpu_percent?: number | undefined;
        memory_mb?: number | undefined;
      }
    | undefined;
  timestamp?: string | undefined;
}

export interface AgentTelemetryRecord extends AgentHeartbeatPayload {
  last_heartbeat_at: string;
}

export class MetricsCollector {
  private readonly requestCounts = new Map<string, number>(); // "METHOD /route STATUS" -> count
  private readonly errorCounts = new Map<string, number>(); // "ERROR_CODE STATUS" -> count
  private readonly jobStatusTransitions = new Map<string, number>(); // "FROM -> TO" -> count
  private readonly requestDurations: number[] = [];
  private readonly agents = new Map<string, AgentTelemetryRecord>();

  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const key = `${method.toUpperCase()} ${route} ${statusCode}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);

    if (this.requestDurations.length < 5000) {
      this.requestDurations.push(durationMs);
    } else {
      this.requestDurations[Math.floor(Math.random() * this.requestDurations.length)] = durationMs;
    }

    if (statusCode >= 400) {
      const errKey = `HTTP_${statusCode} ${route}`;
      this.errorCounts.set(errKey, (this.errorCounts.get(errKey) || 0) + 1);
    }
  }

  recordError(code: string, statusCode: number): void {
    const key = `${code} ${statusCode}`;
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
  }

  recordJobTransition(fromStatus: string, toStatus: string): void {
    const key = `${fromStatus} -> ${toStatus}`;
    this.jobStatusTransitions.set(key, (this.jobStatusTransitions.get(key) || 0) + 1);
  }

  recordAgentHeartbeat(payload: AgentHeartbeatPayload): void {
    const now = new Date().toISOString();
    const record: AgentTelemetryRecord = {
      ...payload,
      last_heartbeat_at: now
    };
    this.agents.set(payload.agent_id, record);
  }

  isAgentOnline(agentId: string, timeoutSeconds = 60): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    const lastSeenMs = new Date(agent.last_heartbeat_at).getTime();
    return Date.now() - lastSeenMs < timeoutSeconds * 1000;
  }

  getActiveAgents(timeoutSeconds = 60): AgentTelemetryRecord[] {
    const now = Date.now();
    return Array.from(this.agents.values()).filter(agent => {
      const lastSeenMs = new Date(agent.last_heartbeat_at).getTime();
      return now - lastSeenMs < timeoutSeconds * 1000;
    });
  }

  getAgent(agentId: string): AgentTelemetryRecord | null {
    const agent = this.agents.get(agentId);
    return agent ? { ...agent } : null;
  }

  getMetricsSnapshot(): {
    http_requests_total: Record<string, number>;
    http_errors_total: Record<string, number>;
    job_transitions_total: Record<string, number>;
    active_agents_count: number;
    total_registered_agents: number;
    latency_ms: {
      avg: number;
      p95: number;
      p99: number;
      sample_count: number;
    };
    uptime_seconds: number;
  } {
    const totalRequests = Object.fromEntries(this.requestCounts.entries());
    const totalErrors = Object.fromEntries(this.errorCounts.entries());
    const totalTransitions = Object.fromEntries(this.jobStatusTransitions.entries());

    let avgLatency = 0;
    let p95 = 0;
    let p99 = 0;

    if (this.requestDurations.length > 0) {
      const sorted = [...this.requestDurations].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      avgLatency = Math.round((sum / sorted.length) * 100) / 100;
      p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0);
      p99 = Math.round(sorted[Math.floor(sorted.length * 0.99)] ?? 0);
    }

    return {
      http_requests_total: totalRequests,
      http_errors_total: totalErrors,
      job_transitions_total: totalTransitions,
      active_agents_count: this.getActiveAgents().length,
      total_registered_agents: this.agents.size,
      latency_ms: {
        avg: avgLatency,
        p95,
        p99,
        sample_count: this.requestDurations.length
      },
      uptime_seconds: Math.floor(process.uptime())
    };
  }

  clear(): void {
    this.requestCounts.clear();
    this.errorCounts.clear();
    this.jobStatusTransitions.clear();
    this.requestDurations.length = 0;
    this.agents.clear();
  }
}

export const defaultMetrics = new MetricsCollector();
