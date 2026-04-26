import { Controller, Get, Post, Body, Put, Param, Delete, Query, UseInterceptors, UploadedFile, Req, UseGuards } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('products')
export class ProductController {
    constructor(private readonly productService: ProductService) { }

    @Post()
    @UseGuards(TenantWriteGuard)
    @UseInterceptors(FileInterceptor('photo', {
        storage: diskStorage({
            destination: './uploads',
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
            }
        })
    }))
    create(
        @Body() createProductDto: CreateProductDto,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: any
    ) {
        const photoPath = file ? `/uploads/${file.filename}` : null;
        return this.productService.create(createProductDto, photoPath, req.user.email, req.activeTenantId);
    }

    @Get()
    findAll(
        @Req() req: any,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
    ) {
        return this.productService.findAll(
            req.activeTenantId,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
            search,
        );
    }

    @Get(':id')
    findOne(@Param('id') id: string, @Req() req: any) {
        return this.productService.findOne(id, req.activeTenantId);
    }

    @Put(':id')
    @UseGuards(TenantWriteGuard)
    @UseInterceptors(FileInterceptor('photo', {
        storage: diskStorage({
            destination: './uploads',
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
            }
        })
    }))
    update(
        @Param('id') id: string,
        @Body() updateProductDto: UpdateProductDto,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: any
    ) {
        const photoPath = file ? `/uploads/${file.filename}` : null;
        return this.productService.update(id, updateProductDto, photoPath, req.user.email, req.activeTenantId);
    }

    @Post(':id/stock-adjust')
    @UseGuards(TenantWriteGuard)
    adjustStock(
        @Param('id') id: string,
        @Body() adjustStockDto: AdjustStockDto,
        @Req() req: any
    ) {
        return this.productService.adjustStock(id, adjustStockDto.delta, req.user.email, req.activeTenantId, adjustStockDto.note);
    }

    @Delete(':id')
    @UseGuards(TenantWriteGuard)
    remove(@Param('id') id: string, @Req() req: any) {
        return this.productService.remove(id, req.user.email, req.activeTenantId);
    }

    @Post('import')
    @UseGuards(TenantWriteGuard)
    importProducts(@Body() body: { items: Array<{ sku: string; name: string; wbBarcode?: string }> }, @Req() req: any) {
        return this.productService.importFromWb(body.items, req.user.email, req.activeTenantId);
    }
}
