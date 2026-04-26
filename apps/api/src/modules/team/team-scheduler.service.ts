import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeamSchedulerService {
    private readonly logger = new Logger(TeamSchedulerService.name);

    constructor(private readonly prisma: PrismaService) {}

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async expireStaleInvitations(): Promise<void> {
        const now = new Date();

        const result = await this.prisma.invitation.updateMany({
            where: { status: 'PENDING', expiresAt: { lt: now } },
            data: { status: 'EXPIRED' },
        });

        if (result.count > 0) {
            this.logger.log(
                JSON.stringify({
                    event: 'invitations_expired',
                    count: result.count,
                    ts: now.toISOString(),
                }),
            );
        }
    }
}
