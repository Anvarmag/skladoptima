import {
    Controller,
    Get,
    Post,
    Body,
    Put,
    Patch,
    Param,
    Delete,
    Query,
    UseInterceptors,
    UploadedFile,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

const photoUpload = FileInterceptor('photo', {
    storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
    }),
});

@UseGuards(RequireActiveTenantGuard)
@Controller('products')
export class ProductController {
    constructor(private readonly productService: ProductService) { }

    // POST /products — создать товар
    // При SKU soft-deleted товара: вернёт 409 SKU_SOFT_DELETED с deletedProductId
    // Для восстановления — передать confirmRestoreId в теле
    @Post()
    @UseGuards(TenantWriteGuard)
    @UseInterceptors(photoUpload)
    create(
        @Body() dto: CreateProductDto,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: any,
    ) {
        const photoPath = file ? `/uploads/${file.filename}` : null;
        return this.productService.create(dto, photoPath, req.user.email, req.activeTenantId, req.user.id);
    }

    // GET /products — список товаров. status=deleted показывает архивированные.
    @Get()
    findAll(
        @Req() req: any,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('status') status?: string,
    ) {
        return this.productService.findAll(
            req.activeTenantId,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
            search,
            status,
        );
    }

    // GET /products/:id — карточка товара
    @Get(':id')
    findOne(@Param('id') id: string, @Req() req: any) {
        return this.productService.findOne(id, req.activeTenantId);
    }

    // PATCH /products/:id — обновить товар (partial update)
    @Patch(':id')
    @UseGuards(TenantWriteGuard)
    @UseInterceptors(photoUpload)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateProductDto,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: any,
    ) {
        const photoPath = file ? `/uploads/${file.filename}` : null;
        return this.productService.update(id, dto, photoPath, req.user.email, req.activeTenantId, req.user.id);
    }

    // PUT /products/:id — backward-compatible alias для PATCH
    @Put(':id')
    @UseGuards(TenantWriteGuard)
    @UseInterceptors(photoUpload)
    updatePut(
        @Param('id') id: string,
        @Body() dto: UpdateProductDto,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: any,
    ) {
        const photoPath = file ? `/uploads/${file.filename}` : null;
        return this.productService.update(id, dto, photoPath, req.user.email, req.activeTenantId, req.user.id);
    }

    // DELETE /products/:id — soft delete
    @Delete(':id')
    @UseGuards(TenantWriteGuard)
    remove(@Param('id') id: string, @Req() req: any) {
        return this.productService.remove(id, req.user.email, req.activeTenantId, req.user.id);
    }

    // POST /products/:id/restore — явное восстановление удалённого товара
    @Post(':id/restore')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    restore(@Param('id') id: string, @Req() req: any) {
        return this.productService.restore(id, req.user.email, req.activeTenantId, req.user.id);
    }

    // POST /products/:id/stock-adjust — корректировка остатка
    @Post(':id/stock-adjust')
    @UseGuards(TenantWriteGuard)
    adjustStock(
        @Param('id') id: string,
        @Body() dto: AdjustStockDto,
        @Req() req: any,
    ) {
        return this.productService.adjustStock(id, dto.delta, req.user.email, req.activeTenantId, dto.note);
    }

    // POST /products/import — legacy WB import
    @Post('import')
    @UseGuards(TenantWriteGuard)
    importProducts(
        @Body() body: { items: Array<{ sku: string; name: string; wbBarcode?: string }> },
        @Req() req: any,
    ) {
        return this.productService.importFromWb(body.items, req.user.email, req.activeTenantId, req.user.id);
    }
}
