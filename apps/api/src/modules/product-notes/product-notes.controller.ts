import {
    Controller, Get, Post, Patch, Delete,
    Body, Param, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import { ProductNotesService } from './product-notes.service';
import { CreateProductNoteDto } from './dto/create-note.dto';
import { UpdateProductNoteDto } from './dto/update-note.dto';

@UseGuards(RequireActiveTenantGuard)
@Controller('products/:productId/notes')
export class ProductNotesController {
    constructor(private readonly service: ProductNotesService) {}

    @Get()
    list(@Req() req: any, @Param('productId') productId: string) {
        return this.service.list(req.activeTenantId, productId);
    }

    @Post()
    @UseGuards(TenantWriteGuard)
    create(
        @Req() req: any,
        @Param('productId') productId: string,
        @Body() dto: CreateProductNoteDto,
    ) {
        return this.service.create(req.activeTenantId, productId, req.user.id, dto);
    }

    @Patch(':noteId')
    @UseGuards(TenantWriteGuard)
    update(
        @Req() req: any,
        @Param('productId') productId: string,
        @Param('noteId') noteId: string,
        @Body() dto: UpdateProductNoteDto,
    ) {
        return this.service.update(req.activeTenantId, productId, noteId, req.user.id, dto);
    }

    @Delete(':noteId')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    remove(
        @Req() req: any,
        @Param('productId') productId: string,
        @Param('noteId') noteId: string,
    ) {
        return this.service.remove(req.activeTenantId, productId, noteId, req.user.id);
    }
}
