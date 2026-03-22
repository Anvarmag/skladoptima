import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
    imports: [AuditModule],
    providers: [ProductService],
    controllers: [ProductController],
})
export class ProductModule { }
