import { WarehouseType, WarehouseSourceMarketplace } from '@prisma/client';
import { WarehouseSnapshot } from '../warehouse-snapshot';

/**
 * Ozon API `/v1/warehouse/list` возвращает объекты вида:
 *   { warehouse_id, name, is_rfbs, is_economy, status, ... }
 * Из них формируем reference-записи. FBO Ozon склады поставщику не отдаются
 * (Ozon владеет ими сам), поэтому endpoint покрывает только FBS-контур
 * (включая rFBS), что соответствует §14 system-analytics: FBO остаётся
 * информационным контуром в inventory.
 *
 * Классификация FBS/FBO:
 *   - is_rfbs=true   → FBS (rFBS = realFBS, склад продавца);
 *   - иначе          → FBS (Ozon FBS-склад продавца);
 *   - FBO записи в этот endpoint не приходят, для них в MVP справочник не
 *     ведётся (см. §14 system-analytics, §1 task task scope).
 */
export function normalizeOzonWarehouse(raw: any): WarehouseSnapshot | null {
    if (!raw) return null;

    const externalId = raw.warehouse_id !== undefined && raw.warehouse_id !== null
        ? String(raw.warehouse_id)
        : null;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!externalId || !name) return null;

    return {
        externalWarehouseId: externalId.slice(0, 128),
        name: name.slice(0, 255),
        city: typeof raw.city === 'string' && raw.city.trim()
            ? raw.city.trim().slice(0, 128)
            : null,
        warehouseType: WarehouseType.FBS,
        sourceMarketplace: WarehouseSourceMarketplace.OZON,
    };
}

export function normalizeOzonWarehouseList(rawList: any[] | undefined | null): WarehouseSnapshot[] {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set<string>();
    const out: WarehouseSnapshot[] = [];
    for (const raw of rawList) {
        const snap = normalizeOzonWarehouse(raw);
        if (!snap) continue;
        if (seen.has(snap.externalWarehouseId)) continue;
        seen.add(snap.externalWarehouseId);
        out.push(snap);
    }
    return out;
}
