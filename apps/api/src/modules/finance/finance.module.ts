import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { FinanceCalculatorService } from './finance-calculator.service';
import { FinanceSnapshotService } from './finance-snapshot.service';
import { FinanceReadService } from './finance-read.service';
import { FinanceCostProfileService } from './finance-cost-profile.service';
import { FinancePolicyService } from './finance-policy.service';
import { FinanceMetricsRegistry } from './finance.metrics';

@Module({
    // TASK_FINANCE_2: `FinanceCalculatorService` — pure-function калькулятор.
    // TASK_FINANCE_3: `FinanceSnapshotService` — orchestrator (loader+persist).
    // TASK_FINANCE_4: `FinanceReadService` + `FinanceCostProfileService` (REST).
    // TASK_FINANCE_5: `FinancePolicyService` — централизованный tenant guard
    //                  + manual whitelist + stale/incomplete classification.
    // TASK_FINANCE_7: `FinanceMetricsRegistry` — observability (snapshot
    //                  build counters, latency p50/p95, blocked-by-tenant,
    //                  manual-input-rejected, cost-profile-updates).
    // Legacy `FinanceService.calculateUnitEconomics` остаётся под endpoint
    // `/finance/unit-economics/legacy` для backward-compat.
    providers: [
        FinanceService,
        FinanceCalculatorService,
        FinanceSnapshotService,
        FinanceReadService,
        FinanceCostProfileService,
        FinancePolicyService,
        FinanceMetricsRegistry,
    ],
    controllers: [FinanceController],
    exports: [
        FinanceService,
        FinanceCalculatorService,
        FinanceSnapshotService,
        FinanceReadService,
        FinanceCostProfileService,
        FinancePolicyService,
        FinanceMetricsRegistry,
    ],
})
export class FinanceModule { }
