import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { StockLocksService } from './stock-locks.service';
import { CreateStockLockDto } from './dto/create-stock-lock.dto';
import { ListStockLocksQuery } from './dto/list-stock-locks.query';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import { MarketplaceType } from '@prisma/client';

@UseGuards(RequireActiveTenantGuard)
@Controller('stock-locks')
export class StockLocksController {
    constructor(private readonly stockLocksService: StockLocksService) {}

    // GET /stock-locks — список блокировок тенанта с опциональными фильтрами
    @Get()
    list(@Req() req: any, @Query() query: ListStockLocksQuery) {
        return this.stockLocksService.list(req.activeTenantId, query);
    }

    // POST /stock-locks — создать/обновить блокировку (upsert по tenantId+productId+marketplace)
    @Post()
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.CREATED)
    createOrUpdate(@Body() dto: CreateStockLockDto, @Req() req: any) {
        return this.stockLocksService.createOrUpdate(req.activeTenantId, req.user?.id, dto);
    }

    // DELETE /stock-locks/:lockId — снять блокировку по id
    @Delete(':lockId')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@Param('lockId') lockId: string, @Req() req: any) {
        await this.stockLocksService.remove(req.activeTenantId, lockId, req.user?.id);
    }

    // DELETE /stock-locks?productId=X&marketplace=Y — снять блокировку по составному ключу
    @Delete()
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    async removeByKey(
        @Query('productId') productId: string,
        @Query('marketplace') marketplace: MarketplaceType,
        @Req() req: any,
    ) {
        await this.stockLocksService.removeByKey(req.activeTenantId, productId, marketplace, req.user?.id);
    }
}
