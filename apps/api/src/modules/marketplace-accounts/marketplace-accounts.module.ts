import { Module, forwardRef } from '@nestjs/common';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { MarketplaceAccountsController } from './marketplace-accounts.controller';
import { CredentialsCipher } from './credentials-cipher.service';
import { CredentialValidator } from './credential-validator.service';
import { SyncModule } from '../marketplace_sync/sync.module';

@Module({
    imports: [forwardRef(() => SyncModule)],
    providers: [MarketplaceAccountsService, CredentialsCipher, CredentialValidator],
    controllers: [MarketplaceAccountsController],
    exports: [MarketplaceAccountsService, CredentialsCipher, CredentialValidator],
})
export class MarketplaceAccountsModule {}
