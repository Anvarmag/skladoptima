import { Injectable, Logger } from '@nestjs/common';
import { WorkerJobType } from '@prisma/client';
import { IJobHandler } from './job-handler.interface';

/**
 * Central registry that maps WorkerJobType → IJobHandler.
 *
 * Domain modules call register() during their initialization to plug in handlers.
 * WorkerRuntimeService calls get() before executing each job.
 *
 * Usage in a domain module:
 *   constructor(private readonly registry: JobHandlerRegistry, ...) {
 *     registry.register('SYNC', this);
 *   }
 */
@Injectable()
export class JobHandlerRegistry {
    private readonly logger = new Logger(JobHandlerRegistry.name);
    private readonly handlers = new Map<WorkerJobType, IJobHandler>();

    register(jobType: WorkerJobType, handler: IJobHandler): void {
        if (this.handlers.has(jobType)) {
            this.logger.warn(`Handler for ${jobType} is already registered — overwriting.`);
        }
        this.handlers.set(jobType, handler);
        this.logger.log(`Handler registered for job type: ${jobType}`);
    }

    get(jobType: WorkerJobType): IJobHandler | undefined {
        return this.handlers.get(jobType);
    }

    registeredTypes(): WorkerJobType[] {
        return [...this.handlers.keys()];
    }
}
