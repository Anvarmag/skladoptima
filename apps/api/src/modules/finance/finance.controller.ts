import { Controller, Get, Query, Req } from '@nestjs/common';
import { FinanceService } from './finance.service';

@Controller('finance')
export class FinanceController {
    constructor(private readonly financeService: FinanceService) { }

    @Get('unit-economics')
    async getUnitEconomics(
        @Req() req: any,
        @Query('productId') productId: string,
    ) {
        return this.financeService.calculateUnitEconomics(req.user.tenantId, productId);
    }
}
