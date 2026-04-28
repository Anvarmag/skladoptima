import { Module } from '@nestjs/common';
import { SyncRunsService } from './sync-runs.service';
import { SyncRunsController } from './sync-runs.controller';
import { SyncPreflightService } from './sync-preflight.service';
import { SyncDiagnosticsService } from './sync-diagnostics.service';
import { SyncConflictsController } from './sync-conflicts.controller';
import { SyncRunWorker } from './sync-run-worker.service';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';

@Module({
    // MarketplaceAccountsModule поставляет MarketplaceAccountsService.reportSyncRun
    // — публичный API для handoff sync health (§20 invariant: sync health и
    // credential validity — независимые слои, единая точка обновления только
    // через marketplace-accounts).
    imports: [MarketplaceAccountsModule],
    providers: [
        SyncRunsService,
        SyncPreflightService,
        SyncDiagnosticsService,
        SyncRunWorker,
    ],
    controllers: [SyncRunsController, SyncConflictsController],
    exports: [
        SyncRunsService,
        SyncPreflightService,
        SyncDiagnosticsService,
        SyncRunWorker,
    ],
})
export class SyncRunsModule {}
