/**
 * TASK_TASKS_6: observability контракт для tasks domain.
 *
 * §19 system-analytics требует метрики:
 *   - `tasks_created` — counter (per category);
 *   - `tasks_completed` — counter;
 *   - `tasks_overdue_active` — gauge (current overdue active count);
 *   - `task_avg_time_to_complete_ms` — histogram;
 *   - `task_notifications_sent` — counter (per channel: max/telegram);
 *   - `task_notification_send_failures` — counter.
 *
 * Дополнительно (§15, §20) — counters cron-decisions:
 *   - `task_due_reminder_sent` / `task_overdue_notified` — успешный пуш;
 *   - `task_cron_skipped_paused_tenant` — skip из-за paused tenant'а;
 *   - `task_comment_debounce_collapsed` — серия комментариев → один пуш.
 *
 * Реализация — process-local in-memory counters + structured-логи (по
 * образцу `OrdersMetricsRegistry` / `FinanceMetricsRegistry`).
 * Не Prometheus client сознательно: integration через log-based metrics
 * в Loki/Datadog для MVP достаточно (см. §19 system-analytics).
 *
 * Histogram'ы tracking'аются скользящим окном последних 200 наблюдений
 * — упрощение для MVP, не Prometheus histogram. Достаточно для p50/p95
 * в health-эндпоинте и быстрой диагностики.
 */

import { Injectable, Logger } from '@nestjs/common';

export const TasksMetricNames = {
    CREATED: 'tasks_created',
    COMPLETED: 'tasks_completed',
    OVERDUE_ACTIVE: 'tasks_overdue_active',
    AVG_TIME_TO_COMPLETE_MS: 'task_avg_time_to_complete_ms',
    NOTIFICATIONS_SENT: 'task_notifications_sent',
    NOTIFICATION_SEND_FAILURES: 'task_notification_send_failures',
    DUE_REMINDER_SENT: 'task_due_reminder_sent',
    OVERDUE_NOTIFIED: 'task_overdue_notified',
    CRON_SKIPPED_PAUSED_TENANT: 'task_cron_skipped_paused_tenant',
    COMMENT_DEBOUNCE_COLLAPSED: 'task_comment_debounce_collapsed',
} as const;
export type TasksMetricName = typeof TasksMetricNames[keyof typeof TasksMetricNames];

export interface TasksMetricLabels {
    tenantId?: string;
    /** TaskCategory (MARKETPLACE_CLIENT_ISSUE, OTHER, ...). */
    category?: string;
    /** TaskPriority (LOW, NORMAL, HIGH, URGENT). */
    priority?: string;
    /** Канал доставки нотификации (max / telegram). */
    channel?: string;
    /** Тип уведомления (ASSIGNED, STATUS_CHANGED, COMMENTED, DUE_REMINDER, OVERDUE). */
    notificationType?: string;
    /** Стабильный код причины (TENANT_TRIAL_EXPIRED, NO_PREF, OPT_OUT). */
    reason?: string;
    /** Источник для трассировки — service / cron / notifier. */
    source?: string;
}

@Injectable()
export class TasksMetricsRegistry {
    private readonly logger = new Logger('TasksMetrics');

    /** Глобальные counters per metric name (без cardinality по labels). */
    private readonly counters = new Map<TasksMetricName, number>();

    /** Gauges (например, tasks_overdue_active — текущее число просроченных). */
    private readonly gauges = new Map<TasksMetricName, number>();

    /** Скользящее окно последних N time-to-complete измерений (мс). */
    private readonly completeWindow: number[] = [];
    private readonly COMPLETE_WINDOW_SIZE = 200;

    increment(name: TasksMetricName, labels: TasksMetricLabels = {}, by: number = 1): void {
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

    /**
     * Set absolute gauge (например, tasks_overdue_active = 42).
     * Перезаписывает предыдущее значение — gauge не накапливается.
     */
    setGauge(name: TasksMetricName, value: number, labels: TasksMetricLabels = {}): void {
        this.gauges.set(name, value);
        this.logger.log(
            JSON.stringify({
                metric: name,
                gauge: value,
                ...labels,
                ts: new Date().toISOString(),
            }),
        );
    }

    /**
     * Записывает time-to-complete (DONE.completedAt - createdAt) в
     * скользящее окно. p50/p95 считаются по snapshot()'у.
     */
    observeCompletion(ms: number, labels: TasksMetricLabels = {}): void {
        this.completeWindow.push(ms);
        if (this.completeWindow.length > this.COMPLETE_WINDOW_SIZE) {
            this.completeWindow.shift();
        }
        // Counter "tasks_completed" инкрементим в caller'е (он знает category);
        // здесь только наблюдение latency.
        this.logger.log(
            JSON.stringify({
                metric: TasksMetricNames.AVG_TIME_TO_COMPLETE_MS,
                value: ms,
                ...labels,
                ts: new Date().toISOString(),
            }),
        );
    }

    /** Snapshot для health-эндпоинта или ручной диагностики. */
    snapshot(): {
        counters: Record<string, number>;
        gauges: Record<string, number>;
        completion: { count: number; p50: number | null; p95: number | null };
    } {
        const counters: Record<string, number> = {};
        for (const [k, v] of this.counters.entries()) counters[k] = v;

        const gauges: Record<string, number> = {};
        for (const [k, v] of this.gauges.entries()) gauges[k] = v;

        const sorted = [...this.completeWindow].sort((a, b) => a - b);
        const p = (q: number) =>
            sorted.length === 0
                ? null
                : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

        return {
            counters,
            gauges,
            completion: { count: sorted.length, p50: p(0.5), p95: p(0.95) },
        };
    }

    /** Только для тестов — обнуляет всё состояние. */
    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.completeWindow.length = 0;
    }
}
