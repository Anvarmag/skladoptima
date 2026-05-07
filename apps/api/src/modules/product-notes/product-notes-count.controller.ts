import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { ProductNotesService } from './product-notes.service';

@UseGuards(RequireActiveTenantGuard)
@Controller('product-notes-count')
export class ProductNotesCountController {
    constructor(private readonly service: ProductNotesService) {}

    @Get()
    count(@Req() req: any, @Query('ids') ids: string) {
        const productIds = ids ? ids.split(',').filter(Boolean) : [];
        return this.service.countByIds(req.activeTenantId, productIds);
    }
}
