import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    Headers,
    UnauthorizedException,
} from '@nestjs/common';
import { WorkerService, ListJobsFilter } from './worker.service';
import { WorkerAlertsService } from './worker-alerts.service';
import { WorkerJobStatus, WorkerJobType } from '@prisma/client';
import { Public } from '../auth/public.decorator';

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? '';

function assertInternalSecret(secret: string | undefined): void {
    if (!INTERNAL_API_SECRET || secret !== INTERNAL_API_SECRET) {
        throw new UnauthorizedException({ code: 'WORKER_INTERNAL_ACCESS_DENIED' });
    }
}

// All endpoints require INTERNAL_API_SECRET (support/admin scope, §6 system-analytics).
// Public decorator skips JWT guard; auth is done via x-internal-secret header.
@Public()
@Controller('worker')
export class WorkerController {
    constructor(
        private readonly workerService:  WorkerService,
        private readonly alertsService:  WorkerAlertsService,
    ) {}

    // ─── GET /worker/jobs ────────────────────────────────────────────────────

    @Get('jobs')
    async listJobs(
        @Headers('x-internal-secret') secret: string | undefined,
        @Query('status')   status?:   string,
        @Query('jobType')  jobType?:  string,
        @Query('tenantId') tenantId?: string,
        @Query('page')     page?:     string,
        @Query('limit')    limit?:    string,
    ) {
        assertInternalSecret(secret);

        const filter: ListJobsFilter = {
            ...(status   ? { status:   status   as WorkerJobStatus }  : {}),
            ...(jobType  ? { jobType:  jobType  as WorkerJobType }    : {}),
            ...(tenantId ? { tenantId }                               : {}),
            page:  page  ? parseInt(page,  10) : 1,
            limit: limit ? parseInt(limit, 10) : 20,
        };

        return this.workerService.listJobs(filter);
    }

    // ─── GET /worker/jobs/:jobId ─────────────────────────────────────────────

    @Get('jobs/:jobId')
    async getJob(
        @Headers('x-internal-secret') secret: string | undefined,
        @Param('jobId') jobId: string,
    ) {
        assertInternalSecret(secret);
        return this.workerService.getJob(jobId);
    }

    // ─── POST /worker/jobs/:jobId/retry ──────────────────────────────────────

    @Post('jobs/:jobId/retry')
    async retryJob(
        @Headers('x-internal-secret') secret: string | undefined,
        @Param('jobId') jobId: string,
    ) {
        assertInternalSecret(secret);
        return this.workerService.retryJob(jobId);
    }

    // ─── POST /worker/jobs/:jobId/cancel ─────────────────────────────────────

    @Post('jobs/:jobId/cancel')
    async cancelJob(
        @Headers('x-internal-secret') secret: string | undefined,
        @Param('jobId') jobId: string,
    ) {
        assertInternalSecret(secret);
        return this.workerService.cancelJob(jobId);
    }

    // ─── GET /worker/queues/health ───────────────────────────────────────────

    @Get('queues/health')
    async getQueuesHealth(
        @Headers('x-internal-secret') secret: string | undefined,
    ) {
        assertInternalSecret(secret);
        return this.workerService.getQueuesHealth();
    }

    // ─── GET /worker/schedules ───────────────────────────────────────────────

    @Get('schedules')
    async listSchedules(
        @Headers('x-internal-secret') secret: string | undefined,
    ) {
        assertInternalSecret(secret);
        return this.workerService.listSchedules();
    }

    // ─── GET /worker/schedules/:name ─────────────────────────────────────────

    @Get('schedules/:name')
    async getSchedule(
        @Headers('x-internal-secret') secret: string | undefined,
        @Param('name') name: string,
    ) {
        assertInternalSecret(secret);
        return this.workerService.getSchedule(name);
    }

    // ─── POST /worker/schedules/:name/run ────────────────────────────────────

    @Post('schedules/:name/run')
    async runSchedule(
        @Headers('x-internal-secret') secret: string | undefined,
        @Param('name') name: string,
    ) {
        assertInternalSecret(secret);
        return this.workerService.runSchedule(name);
    }

    // ─── GET /worker/alerts/check ─────────────────────────────────────────────

    @Get('alerts/check')
    async checkAlerts(
        @Headers('x-internal-secret') secret: string | undefined,
    ) {
        assertInternalSecret(secret);
        return this.alertsService.checkAlerts();
    }
}
