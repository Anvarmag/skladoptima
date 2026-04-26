import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TransitionAccessStateDto } from './dto/transition-access-state.dto';
import { SkipTenantGuard } from './decorators/skip-tenant-guard.decorator';

@SkipTenantGuard()
@Controller('tenants')
export class TenantController {
    constructor(private readonly tenantService: TenantService) {}

    @Post()
    create(@Body() dto: CreateTenantDto, @Req() req: any) {
        return this.tenantService.createTenant(req.user.id, dto);
    }

    @Get()
    list(@Req() req: any) {
        return this.tenantService.listTenants(req.user.id);
    }

    @Get('current')
    getCurrent(@Req() req: any) {
        return this.tenantService.getCurrentTenant(req.user.id);
    }

    @Get(':tenantId')
    getOne(@Param('tenantId') tenantId: string, @Req() req: any) {
        return this.tenantService.getTenant(req.user.id, tenantId);
    }

    @Post(':tenantId/switch')
    switch(@Param('tenantId') tenantId: string, @Req() req: any) {
        return this.tenantService.switchTenant(req.user.id, tenantId);
    }

    @Get(':tenantId/access-warnings')
    getAccessWarnings(@Param('tenantId') tenantId: string, @Req() req: any) {
        return this.tenantService.getAccessWarnings(req.user.id, tenantId);
    }

    @Post(':tenantId/access-state-transitions')
    transitionAccessState(
        @Param('tenantId') tenantId: string,
        @Body() dto: TransitionAccessStateDto,
    ) {
        return this.tenantService.transitionAccessState(tenantId, dto);
    }

    @Post(':tenantId/close')
    close(@Param('tenantId') tenantId: string, @Req() req: any) {
        return this.tenantService.closeTenant(req.user.id, tenantId);
    }

    @Post(':tenantId/restore')
    restore(@Param('tenantId') tenantId: string, @Req() req: any) {
        return this.tenantService.restoreTenant(req.user.id, tenantId);
    }
}
