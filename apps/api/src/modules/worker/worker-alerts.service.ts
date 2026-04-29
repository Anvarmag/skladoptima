import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Alert thresholds ─────────────────────────────────────────────────────────

const BACKLOG_WARN_THRESHOLD   = 100;  // queued + retrying total
const FINAL_FAILED_SPIKE_COUNT =  10;  // failed + dead_lettered in last 1 hour
const DEAD_LETTER_WARN_COUNT   =  50;  // total dead_lettered across all queues
const MISSED_SCHEDULE_LAG_MS   = 10 * 60 * 1000; // 10 min overdue = missed

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertType =
    | 'backlog_growth'
    | 'final_failed_spike'
    | 'dead_letter_growth'
    | 'stuck_jobs'
    | 'missed_schedule';

export type AlertSeverity = 'warning' | 'critical';

export interface AlertSignal {
    type:     AlertType;
    severity: AlertSeverity;
    details:  Record<string, unknown>;
}

export interface AlertSnapshot {
    alerts:     AlertSignal[];
    checkedAt:  string;
    healthy:    boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WorkerAlertsService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Evaluates all alert conditions and returns a structured snapshot.
     * Used by GET /worker/alerts/check (support/admin only).
     * Designed to be polled by an external monitor or cron; does not send
     * notifications itself — that is the consumer's responsibility.
     */
    async checkAlerts(): Promise<AlertSnapshot> {
        const [
            backlogCount,
            recentFinalFailedCount,
            deadLetterCount,
            stuckCount,
            missedSchedules,
        ] = await Promise.all([
            this.queryBacklogCount(),
            this.queryRecentFinalFailed(),
            this.queryDeadLetterCount(),
            this.queryStuckJobs(),
            this.queryMissedSchedules(),
        ]);

        const alerts: AlertSignal[] = [];

        if (backlogCount > BACKLOG_WARN_THRESHOLD) {
            alerts.push({
                type:     'backlog_growth',
                severity: 'warning',
                details:  { count: backlogCount, threshold: BACKLOG_WARN_THRESHOLD },
            });
        }

        if (recentFinalFailedCount > FINAL_FAILED_SPIKE_COUNT) {
            alerts.push({
                type:     'final_failed_spike',
                severity: 'critical',
                details:  { count: recentFinalFailedCount, windowHours: 1, threshold: FINAL_FAILED_SPIKE_COUNT },
            });
        }

        if (deadLetterCount > DEAD_LETTER_WARN_COUNT) {
            alerts.push({
                type:     'dead_letter_growth',
                severity: 'warning',
                details:  { count: deadLetterCount, threshold: DEAD_LETTER_WARN_COUNT },
            });
        }

        if (stuckCount > 0) {
            alerts.push({
                type:     'stuck_jobs',
                severity: 'warning',
                details:  { count: stuckCount },
            });
        }

        if (missedSchedules.length > 0) {
            alerts.push({
                type:     'missed_schedule',
                severity: 'warning',
                details:  { schedules: missedSchedules, lagThresholdMs: MISSED_SCHEDULE_LAG_MS },
            });
        }

        return {
            alerts,
            checkedAt: new Date().toISOString(),
            healthy:   alerts.length === 0,
        };
    }

    // ─── Private query helpers ───────────────────────────────────────────────

    private async queryBacklogCount(): Promise<number> {
        return this.prisma.workerJob.count({
            where: { status: { in: ['queued', 'retrying'] } },
        });
    }

    private async queryRecentFinalFailed(): Promise<number> {
        const since = new Date(Date.now() - 60 * 60 * 1000); // last 1 hour
        return this.prisma.workerJob.count({
            where: {
                status:    { in: ['failed', 'dead_lettered'] },
                finishedAt: { gte: since },
            },
        });
    }

    private async queryDeadLetterCount(): Promise<number> {
        return this.prisma.workerJob.count({
            where: { status: 'dead_lettered' },
        });
    }

    private async queryStuckJobs(): Promise<number> {
        return this.prisma.workerJob.count({
            where: {
                status:    'in_progress',
                leaseUntil: { lt: new Date() },
            },
        });
    }

    private async queryMissedSchedules(): Promise<string[]> {
        const threshold = new Date(Date.now() - MISSED_SCHEDULE_LAG_MS);
        const overdue = await this.prisma.workerSchedule.findMany({
            where: {
                isActive:  true,
                nextRunAt: { lt: threshold },
            },
            select: { name: true },
        });
        return overdue.map((s) => s.name);
    }
}
