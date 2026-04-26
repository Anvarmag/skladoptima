import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('finance')
export class FinanceController {
    constructor(private readonly financeService: FinanceService) { }

    @Get('unit-economics')
    async getUnitEconomics(
        @Req() req: any,
        @Query('productId') productId: string,
    ) {
        return this.financeService.calculateUnitEconomics(req.activeTenantId, productId);
    }
}
