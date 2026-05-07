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
import { GroupService } from './group.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('catalog/groups')
export class GroupController {
    constructor(private readonly groupService: GroupService) {}

    // GET /catalog/groups — все группы тенанта с товарами
    @Get()
    findAll(@Req() req: any) {
        return this.groupService.findAll(req.activeTenantId);
    }

    // GET /catalog/groups/:groupId/members — участники группы (для модала редактирования)
    @Get(':groupId/members')
    findGroupMembers(@Param('groupId') groupId: string, @Req() req: any) {
        return this.groupService.findGroupMembers(req.activeTenantId, groupId);
    }

    // GET /catalog/groups/search?q=&excludeId= — поиск товаров для пикера
    @Get('search')
    search(
        @Req() req: any,
        @Query('q') q: string,
        @Query('excludeId') excludeId?: string,
    ) {
        return this.groupService.searchProducts(req.activeTenantId, q ?? '', excludeId);
    }

    // POST /catalog/groups/link — связать два товара
    @Post('link')
    @UseGuards(TenantWriteGuard)
    link(
        @Body() body: { productAId: string; productBId: string },
        @Req() req: any,
    ) {
        return this.groupService.link(req.activeTenantId, body.productAId, body.productBId);
    }

    // DELETE /catalog/groups/unlink/:productId — убрать товар из группы
    @Delete('unlink/:productId')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    unlink(@Param('productId') productId: string, @Req() req: any) {
        return this.groupService.unlink(req.activeTenantId, productId);
    }

    // POST /catalog/groups/primary/:productId — назначить PRIMARY
    @Post('primary/:productId')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    setPrimary(@Param('productId') productId: string, @Req() req: any) {
        return this.groupService.setPrimary(req.activeTenantId, productId);
    }
}
