import crypto from 'node:crypto';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'firing' | 'resolved';

export interface AlertRecord {
  id: string;
  rule_name: string;
  severity: AlertSeverity;
  status: AlertStatus;
  summary: string;
  description: string;
  context: Record<string, unknown>;
  fired_at: string;
  resolved_at?: string | undefined;
}

export class AlertManager {
  private readonly alerts = new Map<string, AlertRecord>();
  private readonly alertListeners: Array<(alert: AlertRecord) => void> = [];

  onAlert(listener: (alert: AlertRecord) => void): void {
    this.alertListeners.push(listener);
  }

  fireAlert(params: {
    rule_name: string;
    severity: AlertSeverity;
    summary: string;
    description: string;
    context?: Record<string, unknown> | undefined;
  }): AlertRecord {
    // Check if an identical rule is already actively firing
    for (const existing of this.alerts.values()) {
      if (existing.rule_name === params.rule_name && existing.status === 'firing') {
        // Update context & return existing
        existing.context = { ...existing.context, ...(params.context || {}) };
        return existing;
      }
    }

    const alert: AlertRecord = {
      id: crypto.randomUUID(),
      rule_name: params.rule_name,
      severity: params.severity,
      status: 'firing',
      summary: params.summary,
      description: params.description,
      context: params.context || {},
      fired_at: new Date().toISOString()
    };

    this.alerts.set(alert.id, alert);

    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch {
        // Do not crash on listener errors
      }
    }

    return alert;
  }

  resolveAlert(alertId: string): AlertRecord | null {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;

    alert.status = 'resolved';
    alert.resolved_at = new Date().toISOString();
    return alert;
  }

  resolveByRule(ruleName: string): number {
    let resolvedCount = 0;
    const now = new Date().toISOString();
    for (const alert of this.alerts.values()) {
      if (alert.rule_name === ruleName && alert.status === 'firing') {
        alert.status = 'resolved';
        alert.resolved_at = now;
        resolvedCount++;
      }
    }
    return resolvedCount;
  }

  simulateAlert(
    ruleName: string,
    context: Record<string, unknown> = {}
  ): AlertRecord {
    return this.fireAlert({
      rule_name: ruleName,
      severity: 'critical',
      summary: `Simulated Incident: ${ruleName}`,
      description: `Synthetic failure triggered for runbook verification and telemetry validation.`,
      context
    });
  }

  getActiveAlerts(): AlertRecord[] {
    return Array.from(this.alerts.values()).filter(a => a.status === 'firing');
  }

  getAllAlerts(): AlertRecord[] {
    return Array.from(this.alerts.values());
  }

  clear(): void {
    this.alerts.clear();
  }
}

export const defaultAlertManager = new AlertManager();
