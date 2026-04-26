import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { AuditModule } from '../audit/audit.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
    imports: [AuditModule, OnboardingModule],
    providers: [ProductService],
    controllers: [ProductController],
})
export class ProductModule { }
