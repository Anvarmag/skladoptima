/**
 * TASK_ADMIN_7: observability контракт для admin/support control plane.
 *
 * §19 system-analytics требует метрики:
 *   - `admin_searches`              — counter: вызовы tenant directory search.
 *   - `tenant_cards_opened`         — counter: открытие tenant 360 (с histogram'ом latency).
 *   - `support_actions_started`     — counter: попытка mutating action (label: actionType).
 *   - `support_actions_failed`      — counter: action завершился failed/blocked.
 *   - `reason_missing_attempts`     — counter: запрос пришёл без валидного reason
 *                                      (DTO ValidationException перехватывается на
 *                                      controller-уровне через global pipe — этот
 *                                      counter инкрементится из ExceptionFilter,
 *                                      сейчас использует `notes_created`-подобный
 *                                      hook для контроля «попыток без reason»).
 *   - `notes_created`               — counter: добавлено internal notes.
 *   - `denied_attempts`             — counter: RBAC отказ (admin_rbac_denied).
 *   - `tenant_access_breadth`       — gauge per support user: сколько уникальных
 *                                      tenant'ов посещено за окно (наблюдается
 *                                      алертом «один оператор смотрит много»).
 *   - `support_action_duration_ms`  — histogram p50/p95 (общая длительность action).
 *
 * Реализация — process-local in-memory counters + structured logs
 * (тот же подход, что у `TasksMetricsRegistry` / `AnalyticsMetricsRegistry`).
 * Не Prometheus client сознательно: integration через log-based metrics
 * в Loki/Datadog для MVP достаточно (см. §19 system-analytics).
 *
 * Histogram'ы tracking'аются скользящим окном последних 200 наблюдений —
 * упрощение для MVP, но достаточное для p50/p95 в health-эндпоинте и
 * быстрой диагностики SLA по tenant 360 (§18 — целевой p95 < 700 мс).
 */

import { Injectable, Logger } from '@nestjs/common';

export const AdminMetricNames = {
    /// Tenant directory search.
    ADMIN_SEARCHES: 'admin_searches',
    /// Tenant 360 view opens — counter.
    TENANT_CARDS_OPENED: 'tenant_cards_opened',
    /// Tenant 360 build latency histogram.
    TENANT_CARD_LATENCY_MS: 'tenant_card_latency_ms',
    /// Support actions — попытка / успех / неуспех.
    SUPPORT_ACTIONS_STARTED: 'support_actions_started',
    SUPPORT_ACTIONS_SUCCEEDED: 'support_actions_succeeded',
    SUPPORT_ACTIONS_FAILED: 'support_actions_failed',
    /// Попытка mutating action без валидного reason — DTO отлуп.
    REASON_MISSING_ATTEMPTS: 'reason_missing_attempts',
    /// Notes / handoff материал.
    NOTES_CREATED: 'notes_created',
    /// RBAC denied — отдельный от security_events counter (live-метрика).
    DENIED_ATTEMPTS: 'denied_attempts',
    /// Соотношение успех/неуспех по биллинг-override.
    BILLING_OVERRIDE_BLOCKED: 'support_billing_override_blocked',
    /// Соотношение успех/неуспех по retention-window restore.
    RESTORE_BLOCKED_BY_RETENTION: 'support_restore_blocked_by_retention',
    /// Длительность support action (mutating path) — histogram.
    SUPPORT_ACTION_DURATION_MS: 'support_action_duration_ms',
    /// Gauge — текущая ширина «admin breadth»: уникальные tenant'ы за окно
    /// per support_user. Алерт §19 «anomalous tenant access breadth».
    TENANT_ACCESS_BREADTH: 'tenant_access_breadth',
} as const;
export type AdminMetricName =
    (typeof AdminMetricNames)[keyof typeof AdminMetricNames];

export interface AdminMetricLabels {
    /// SupportActionType (EXTEND_TRIAL / SET_ACCESS_STATE / RESTORE_TENANT / ...).
    actionType?: string;
    /// Стабильный код причины (BILLING_OVERRIDE_NOT_ALLOWED, ACTION_NOT_ALLOWED_FOR_STATE, ...).
    reason?: string;
    /// SupportUser id — для tenant-access-breadth и анти-аномалии.
    supportUserId?: string;
    /// SupportUserRole (SUPPORT_ADMIN / SUPPORT_READONLY).
    role?: string;
    /// Источник метрики — service / guard / controller.
    source?: string;
}

@Injectable()
export class AdminMetricsRegistry {
    private readonly logger = new Logger('AdminMetrics');

    /// Глобальные counters per metric name (без cardinality по labels).
    private readonly counters = new Map<AdminMetricName, number>();

    /// Gauges (например, tenant_access_breadth по конкретному supportUserId).
    /// Ключ — `${metric}|${supportUserId}` для per-actor значения.
    private readonly gauges = new Map<string, number>();

    /// Скользящее окно tenant-card latency (мс).
    private readonly tenantCardWindow: number[] = [];
    /// Скользящее окно support-action latency (мс).
    private readonly actionWindow: number[] = [];
    private readonly WINDOW_SIZE = 200;

    increment(name: AdminMetricName, labels: AdminMetricLabels = {}, by: number = 1): void {
        const next = (this.counters.get(name) ?? 0) + by;
        this.counters.set(name, next);
        this.logger.log(
            JSON.stringify({
                metric: name,
                value: by,
                total: next,
                ...labels,
                ts: new Date().toISOString(),
            }),
        );
    }

    setBreadthGauge(supportUserId: string, value: number): void {
        const key = `${AdminMetricNames.TENANT_ACCESS_BREADTH}|${supportUserId}`;
        this.gauges.set(key, value);
        this.logger.log(
            JSON.stringify({
                metric: AdminMetricNames.TENANT_ACCESS_BREADTH,
                gauge: value,
                supportUserId,
                ts: new Date().toISOString(),
            }),
        );
    }

    observeTenantCardLatency(ms: number): void {
        this.tenantCardWindow.push(ms);
        if (this.tenantCardWindow.length > this.WINDOW_SIZE) {
            this.tenantCardWindow.shift();
        }
    }

    observeActionDuration(ms: number, labels: AdminMetricLabels = {}): void {
        this.actionWindow.push(ms);
        if (this.actionWindow.length > this.WINDOW_SIZE) {
            this.actionWindow.shift();
        }
        this.logger.log(
            JSON.stringify({
                metric: AdminMetricNames.SUPPORT_ACTION_DURATION_MS,
                value: ms,
                ...labels,
                ts: new Date().toISOString(),
            }),
        );
    }

    snapshot(): {
        counters: Record<string, number>;
        gauges: Record<string, number>;
        tenantCard: { count: number; p50: number | null; p95: number | null };
        action: { count: number; p50: number | null; p95: number | null };
    } {
        const counters: Record<string, number> = {};
        for (const [k, v] of this.counters.entries()) counters[k] = v;

        const gauges: Record<string, number> = {};
        for (const [k, v] of this.gauges.entries()) gauges[k] = v;

        return {
            counters,
            gauges,
            tenantCard: this.computePercentiles(this.tenantCardWindow),
            action: this.computePercentiles(this.actionWindow),
        };
    }

    /// Только для тестов — обнуляет всё состояние.
    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.tenantCardWindow.length = 0;
        this.actionWindow.length = 0;
    }

    private computePercentiles(window: number[]): {
        count: number;
        p50: number | null;
        p95: number | null;
    } {
        const sorted = [...window].sort((a, b) => a - b);
        const p = (q: number) =>
            sorted.length === 0
                ? null
                : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
        return { count: sorted.length, p50: p(0.5), p95: p(0.95) };
    }
}
