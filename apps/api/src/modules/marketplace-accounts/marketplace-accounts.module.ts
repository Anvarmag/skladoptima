import { Module } from '@nestjs/common';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { MarketplaceAccountsController } from './marketplace-accounts.controller';
import { CredentialsCipher } from './credentials-cipher.service';
import { CredentialValidator } from './credential-validator.service';

@Module({
    providers: [MarketplaceAccountsService, CredentialsCipher, CredentialValidator],
    controllers: [MarketplaceAccountsController],
    exports: [MarketplaceAccountsService, CredentialsCipher, CredentialValidator],
})
export class MarketplaceAccountsModule {}
