import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ImportService } from './import.service';
import { ImportController } from './import.controller';
import { MappingService } from './mapping.service';
import { MappingController } from './mapping.controller';
import { GroupService } from './group.service';
import { GroupController } from './group.controller';
import { AuditModule } from '../audit/audit.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
    imports: [AuditModule, OnboardingModule],
    providers: [ProductService, ImportService, MappingService, GroupService],
    controllers: [ProductController, ImportController, MappingController, GroupController],
})
export class ProductModule { }
