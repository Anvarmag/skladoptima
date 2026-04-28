import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import { OrdersReadService } from './orders-read.service';
import { OrdersReprocessService } from './orders-reprocess.service';
import { ListOrdersQueryDto } from './dto/list-orders.query';

/**
 * REST endpoints для orders domain (TASK_ORDERS_5).
 *
 * Маршруты по §6 system-analytics:
 *   - GET  /api/v1/orders                        — User
 *   - GET  /api/v1/orders/:orderId               — User
 *   - GET  /api/v1/orders/:orderId/timeline      — User
 *   - POST /api/v1/orders/:orderId/reprocess     — Owner/Admin
 *
 * Глобальный prefix `/api/v1` задан в `main.ts`, поэтому контроллер
 * объявляет только `orders`.
 *
 * Чтения требуют активного tenant'а (`RequireActiveTenantGuard`).
 * Reprocess дополнительно проходит через `TenantWriteGuard` (политика
 * pause: TRIAL_EXPIRED/SUSPENDED/CLOSED — read доступен, write нет —
 * MVP конвенция). Role gating (Owner/Admin) делает сам сервис, чтобы
 * не плодить новых guard'ов в обход существующего архитектурного
 * решения (на сегодня роли не выставляются в request).
 */
@UseGuards(RequireActiveTenantGuard)
@Controller('orders')
export class OrdersController {
    constructor(
        private readonly read: OrdersReadService,
        private readonly reprocess: OrdersReprocessService,
    ) {}

    @Get()
    list(@Req() req: any, @Query() query: ListOrdersQueryDto) {
        return this.read.list(req.activeTenantId, query);
    }

    @Get(':orderId')
    detail(@Req() req: any, @Param('orderId') orderId: string) {
        return this.read.detail(req.activeTenantId, orderId);
    }

    @Get(':orderId/timeline')
    timeline(@Req() req: any, @Param('orderId') orderId: string) {
        return this.read.timeline(req.activeTenantId, orderId);
    }

    /**
     * Safe reprocess: НЕ ходит во внешний API, только перезапускает
     * inventory effect для уже сохранённого заказа. Защита от ошибочных
     * вызовов:
     *   - `TenantWriteGuard` отбивает paused tenant ещё до сервиса;
     *   - сервис проверяет роль (Owner/Admin) и preflight per-account;
     *   - inventory layer идемпотентен через InventoryEffectLock.
     */
    @Post(':orderId/reprocess')
    @UseGuards(TenantWriteGuard)
    triggerReprocess(
        @Req() req: any,
        @Param('orderId') orderId: string,
        @Body() _body: unknown,
    ) {
        return this.reprocess.reprocess({
            tenantId: req.activeTenantId,
            orderId,
            userId: req.user?.id,
        });
    }
}
