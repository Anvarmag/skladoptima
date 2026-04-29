import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WorkerSchedule, WorkerJobType, WorkerJobPriority, Prisma } from '@prisma/client';
import { CronJob } from 'cron';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** How often the scheduler checks for due schedules (ms). */
const SCHEDULER_POLL_INTERVAL_MS = 60_000; // 1 minute

/**
 * If a schedule's nextRunAt is this far in the past when the tick fires,
 * it was a missed run (worker was down). Log an anomaly alert.
 */
const MISSED_RUN_THRESHOLD_MS = 5 * 60_000; // 5 minutes

// ─── Documented schedule seeds (§13, §15 system-analytics) ────────────────────

interface ScheduleSeed {
    name: string;
    cronExpr: string;
    jobType: WorkerJobType;
    queueName: string;
    priority: WorkerJobPriority;
    payload?: Record<string, unknown>;
}

const SCHEDULE_SEEDS: ScheduleSeed[] = [
    {
        name:      'billing-reminders-daily',
        cronExpr:  '0 9 * * *',        // Daily at 09:00 UTC
        jobType:   'BILLING_REMINDER',
        queueName: 'critical',
        priority:  'critical',
    },
    {
        name:      'analytics-rebuild-daily',
        cronExpr:  '0 3 * * *',        // Daily at 03:00 UTC
        jobType:   'ANALYTICS_REBUILD',
        queueName: 'default',
        priority:  'default',
    },
    {
        name:      'file-cleanup-daily',
        cronExpr:  '0 2 * * *',        // Daily at 02:00 UTC
        jobType:   'FILE_CLEANUP',
        queueName: 'bulk',
        priority:  'bulk',
    },
    {
        name:      'audit-maintenance-weekly',
        cronExpr:  '0 1 * * 0',        // Sundays at 01:00 UTC
        jobType:   'AUDIT_MAINTENANCE',
        queueName: 'bulk',
        priority:  'bulk',
    },
];

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WorkerSchedulerService
    implements OnApplicationBootstrap, OnApplicationShutdown
{
    private readonly logger = new Logger(WorkerSchedulerService.name);
    private pollTimer?: NodeJS.Timeout;

    constructor(private readonly prisma: PrismaService) {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async onApplicationBootstrap(): Promise<void> {
        if (process.env.IS_WORKER !== 'true') return;

        this.logger.log(JSON.stringify({
            event: 'scheduler_start',
            scheduleCount: SCHEDULE_SEEDS.length,
            ts: new Date().toISOString(),
        }));

        // Ensure documented schedules exist in the DB (upsert-only, never overwrite)
        await this.seedSchedules();

        // Immediately fire any overdue schedules, then start the polling loop
        await this.tickSchedules();

        this.pollTimer = setInterval(
            () => this.tickSchedules().catch((err) =>
                this.logger.error(JSON.stringify({
                    event: 'scheduler_tick_error',
                    error: err?.message,
                    ts:    new Date().toISOString(),
                })),
            ),
            SCHEDULER_POLL_INTERVAL_MS,
        );
    }

    onApplicationShutdown(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    // ─── Tick ─────────────────────────────────────────────────────────────────

    /**
     * Finds all active schedules that are due (nextRunAt <= now or never run),
     * fires them, and updates lastRunAt / nextRunAt. Logs missed-run anomalies.
     */
    async tickSchedules(): Promise<void> {
        if (process.env.IS_WORKER !== 'true') return;

        const now = new Date();

        const dueSchedules = await this.prisma.workerSchedule.findMany({
            where: {
                isActive: true,
                OR: [
                    { nextRunAt: null },
                    { nextRunAt: { lte: now } },
                ],
            },
            orderBy: { name: 'asc' },
        });

        if (dueSchedules.length === 0) return;

        for (const schedule of dueSchedules) {
            await this.processSchedule(schedule, now);
        }

        this.logger.log(JSON.stringify({
            event:      'scheduler_tick_complete',
            firedCount: dueSchedules.length,
            names:      dueSchedules.map((s) => s.name),
            ts:         now.toISOString(),
        }));
    }

    // ─── Schedule processing ──────────────────────────────────────────────────

    private async processSchedule(schedule: WorkerSchedule, now: Date): Promise<void> {
        // Detect missed run: schedule was overdue beyond the tolerance window
        if (
            schedule.nextRunAt !== null &&
            schedule.nextRunAt.getTime() < now.getTime() - MISSED_RUN_THRESHOLD_MS
        ) {
            this.logger.warn(JSON.stringify({
                event:       'schedule_missed_run_anomaly',
                name:        schedule.name,
                jobType:     schedule.jobType,
                expectedAt:  schedule.nextRunAt.toISOString(),
                overdueMs:   now.getTime() - schedule.nextRunAt.getTime(),
                ts:          now.toISOString(),
            }));
        }

        let nextRunAt: Date;
        try {
            nextRunAt = this.calcNextRunAt(schedule.cronExpr);
        } catch (err) {
            this.logger.error(JSON.stringify({
                event:    'schedule_cron_parse_error',
                name:     schedule.name,
                cronExpr: schedule.cronExpr,
                error:    err instanceof Error ? err.message : String(err),
                ts:       now.toISOString(),
            }));
            return;
        }

        try {
            // Atomically: create job + update schedule timestamps
            const [job] = await this.prisma.$transaction([
                this.prisma.workerJob.create({
                    data: {
                        jobType:            schedule.jobType,
                        queueName:          schedule.queueName,
                        priority:           schedule.priority,
                        payload:            (schedule.payload ?? {}) as Prisma.InputJsonValue,
                        tenantId:           null,
                        idempotencyKey:     null,
                        correlationId:      randomUUID(),
                        createdByActorType: 'scheduler',
                        createdByActorId:   null,
                        maxAttempts:        3,
                        status:             'queued',
                        queuedAt:           now,
                    },
                }),
                this.prisma.workerSchedule.update({
                    where: { id: schedule.id },
                    data:  { lastRunAt: now, nextRunAt },
                }),
            ]);

            this.logger.log(JSON.stringify({
                event:      'schedule_run_fired',
                name:       schedule.name,
                jobType:    schedule.jobType,
                jobId:      job.id,
                nextRunAt:  nextRunAt.toISOString(),
                ts:         now.toISOString(),
            }));
        } catch (err) {
            this.logger.error(JSON.stringify({
                event:   'schedule_fire_error',
                name:    schedule.name,
                jobType: schedule.jobType,
                error:   err instanceof Error ? err.message : String(err),
                ts:      now.toISOString(),
            }));
        }
    }

    // ─── Seed documented schedules ────────────────────────────────────────────

    /**
     * Upserts the documented schedule entries into worker_schedules.
     * Uses update: {} so existing rows (possibly customized by support) are never overwritten.
     */
    private async seedSchedules(): Promise<void> {
        for (const seed of SCHEDULE_SEEDS) {
            await this.prisma.workerSchedule.upsert({
                where:  { name: seed.name },
                update: {},
                create: {
                    name:      seed.name,
                    cronExpr:  seed.cronExpr,
                    jobType:   seed.jobType,
                    queueName: seed.queueName,
                    priority:  seed.priority,
                    payload:   (seed.payload ?? {}) as Prisma.InputJsonValue,
                    isActive:  true,
                },
            });
        }

        this.logger.log(JSON.stringify({
            event:  'scheduler_seeds_applied',
            names:  SCHEDULE_SEEDS.map((s) => s.name),
            ts:     new Date().toISOString(),
        }));
    }

    // ─── Cron next-date calculation ───────────────────────────────────────────

    /**
     * Uses the `cron` package (transitive dep of @nestjs/schedule) to compute
     * the next fire date for a given cron expression.
     */
    private calcNextRunAt(cronExpr: string): Date {
        const job = new CronJob(cronExpr, () => {});
        return job.nextDate().toJSDate();
    }
}
