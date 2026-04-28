import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import {
    MarketplaceType,
    MarketplaceLifecycleStatus,
    MarketplaceCredentialStatus,
} from '@prisma/client';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { CreateMarketplaceAccountDto } from './dto/create-account.dto';
import { UpdateMarketplaceAccountDto } from './dto/update-account.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('marketplace-accounts')
export class MarketplaceAccountsController {
    constructor(private readonly service: MarketplaceAccountsService) {}

    // GET /marketplace-accounts — список подключений tenant с базовыми фильтрами.
    @Get()
    list(
        @Req() req: any,
        @Query('marketplace') marketplace?: string,
        @Query('lifecycleStatus') lifecycleStatus?: string,
        @Query('credentialStatus') credentialStatus?: string,
    ) {
        return this.service.list(req.activeTenantId, {
            marketplace: this._asEnum(marketplace, MarketplaceType),
            lifecycleStatus: this._asEnum(lifecycleStatus, MarketplaceLifecycleStatus),
            credentialStatus: this._asEnum(credentialStatus, MarketplaceCredentialStatus),
        });
    }

    // GET /marketplace-accounts/:id — карточка подключения.
    @Get(':id')
    getById(@Param('id') id: string, @Req() req: any) {
        return this.service.getById(req.activeTenantId, id);
    }

    // GET /marketplace-accounts/:id/diagnostics — расширенная диагностика
    // (4 слоя статуса + effectiveRuntimeState + recentEvents). Не показывает
    // расшифрованные секреты — только masked preview и метаданные.
    @Get(':id/diagnostics')
    diagnostics(@Param('id') id: string, @Req() req: any) {
        return this.service.getDiagnostics(req.activeTenantId, id);
    }

    private _asEnum<E extends Record<string, string>>(value: string | undefined, e: E): E[keyof E] | undefined {
        if (!value) return undefined;
        const upper = String(value).toUpperCase();
        return (Object.values(e) as string[]).includes(upper) ? (upper as E[keyof E]) : undefined;
    }

    // POST /marketplace-accounts — создать подключение.
    // TenantWriteGuard блокирует TRIAL_EXPIRED/SUSPENDED/CLOSED → 403.
    @Post()
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.CREATED)
    create(@Body() dto: CreateMarketplaceAccountDto, @Req() req: any) {
        return this.service.create(req.activeTenantId, dto);
    }

    // PATCH /marketplace-accounts/:id — обновить label и/или credentials.
    // TenantWriteGuard НЕ применяется на уровне контроллера: service-level
    // policy (TASK_5) сама решает per-action — label-only update допустим
    // в TRIAL_EXPIRED, credentials update — нет; SUSPENDED/CLOSED → блок.
    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body() dto: UpdateMarketplaceAccountDto,
        @Req() req: any,
    ) {
        return this.service.update(req.activeTenantId, id, dto);
    }

    // POST /marketplace-accounts/:id/validate — ручная валидация credentials.
    // TenantWriteGuard блокирует TRIAL_EXPIRED/SUSPENDED/CLOSED — внешний API
    // не должен дёргаться для paused tenant'ов (§10 system-analytics).
    @Post(':id/validate')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    validate(@Param('id') id: string, @Req() req: any) {
        return this.service.validate(req.activeTenantId, id);
    }

    // POST /marketplace-accounts/:id/deactivate — внутреннее действие.
    // Service-level policy (TASK_5): допустим в TRIAL_EXPIRED, заблокирован
    // при SUSPENDED/CLOSED. На уровне контроллера TenantWriteGuard НЕ нужен.
    @Post(':id/deactivate')
    @HttpCode(HttpStatus.OK)
    deactivate(@Param('id') id: string, @Req() req: any) {
        return this.service.deactivate(req.activeTenantId, id, req.user?.id ?? null);
    }

    // POST /marketplace-accounts/:id/reactivate — переход в ACTIVE +
    // обязательный re-validate (внешний API), поэтому write guard остаётся.
    @Post(':id/reactivate')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    reactivate(@Param('id') id: string, @Req() req: any) {
        return this.service.reactivate(req.activeTenantId, id, req.user?.id ?? null);
    }
}
