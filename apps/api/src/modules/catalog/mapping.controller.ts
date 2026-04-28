import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { MappingService } from './mapping.service';
import { ManualMappingDto } from './dto/manual-mapping.dto';
import { AutoMatchDto } from './dto/auto-match.dto';
import { MergeProductsDto } from './dto/merge-products.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import { ChannelMarketplace } from '@prisma/client';

@UseGuards(RequireActiveTenantGuard)
@Controller('catalog/mappings')
export class MappingController {
    constructor(private readonly mappingService: MappingService) {}

    // GET /catalog/mappings/unmatched — активные товары без маппинга ни в одном канале.
    // Опциональный фильтр ?marketplace=WB покажет товары без маппинга именно в этом канале.
    @Get('unmatched')
    getUnmatched(
        @Req() req: any,
        @Query('marketplace') marketplace?: ChannelMarketplace,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.mappingService.getUnmatched(
            req.activeTenantId,
            marketplace,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
        );
    }

    // GET /catalog/mappings — все маппинги tenant
    @Get()
    getMappings(
        @Req() req: any,
        @Query('marketplace') marketplace?: ChannelMarketplace,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.mappingService.getMappings(
            req.activeTenantId,
            marketplace,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
        );
    }

    // POST /catalog/mappings/manual — ручной маппинг товара с внешним item.
    // Если маппинг для данного externalProductId уже существует — вернёт 409 MAPPING_ALREADY_EXISTS
    // с existingMappingId, чтобы пользователь мог сначала удалить старый маппинг.
    @Post('manual')
    @UseGuards(TenantWriteGuard)
    createManual(@Body() dto: ManualMappingDto, @Req() req: any) {
        return this.mappingService.createManual(dto, req.activeTenantId, req.user.email, req.user?.id);
    }

    // POST /catalog/mappings/auto-match — автосопоставление внешнего item по SKU.
    // Идемпотентен: если маппинг уже существует — возвращает его с alreadyExisted=true.
    // Если внутренний товар с таким SKU не найден — возвращает matched=false без ошибки.
    @Post('auto-match')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    autoMatch(@Body() dto: AutoMatchDto, @Req() req: any) {
        return this.mappingService.autoMatch(dto, req.activeTenantId, req.user.email, req.user?.id);
    }

    // POST /catalog/mappings/merge — слияние двух дублей.
    // Переносит маппинги из sourceProduct в targetProduct, soft-delete source.
    @Post('merge')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    merge(@Body() dto: MergeProductsDto, @Req() req: any) {
        return this.mappingService.mergeProducts(dto, req.activeTenantId, req.user.email, req.user?.id);
    }

    // DELETE /catalog/mappings/:id — удалить маппинг, чтобы можно было перепривязать
    @Delete(':id')
    @UseGuards(TenantWriteGuard)
    deleteMapping(@Param('id') id: string, @Req() req: any) {
        return this.mappingService.deleteMapping(id, req.activeTenantId, req.user.email);
    }
}
