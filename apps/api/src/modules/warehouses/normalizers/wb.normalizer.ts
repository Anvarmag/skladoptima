import { WarehouseType, WarehouseSourceMarketplace } from '@prisma/client';
import { WarehouseSnapshot } from '../warehouse-snapshot';

/**
 * WB API `/api/v3/warehouses` возвращает массив объектов FBS-складов вида
 * `{ id, name, address, ... }` (productivity API). FBO склады WB живут в
 * другом контуре (`/api/v1/supplier/stocks`) и в виде reference-записей в
 * MVP не нормализуются — для FBO у нас идёт только агрегированный stock-pull.
 *
 * Нормализатор:
 *   - идемпотентен (тот же raw → тот же snapshot);
 *   - не делает HTTP-запросов;
 *   - всё, что не парсится — пропускается с `null` возвратом, чтобы один
 *     битый элемент не валил весь батч (sync-сервис складирует все ненулы).
 */
export function normalizeWbWarehouse(raw: any): WarehouseSnapshot | null {
    if (!raw) return null;

    const externalId = raw.id !== undefined && raw.id !== null
        ? String(raw.id)
        : null;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';

    if (!externalId || !name) return null;

    const city = typeof raw.address === 'string'
        ? raw.address.split(',')[0]?.trim() || null
        : (typeof raw.city === 'string' ? raw.city.trim() : null);

    return {
        externalWarehouseId: externalId.slice(0, 128),
        name: name.slice(0, 255),
        city: city ? city.slice(0, 128) : null,
        warehouseType: WarehouseType.FBS,
        sourceMarketplace: WarehouseSourceMarketplace.WB,
    };
}

/**
 * Нормализует массив raw-ответа WB. Дедупликация по `externalWarehouseId` —
 * на случай, если API вернёт один и тот же склад дважды (видели на supplier
 * staging). Идемпотентно.
 */
export function normalizeWbWarehouseList(rawList: any[] | undefined | null): WarehouseSnapshot[] {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set<string>();
    const out: WarehouseSnapshot[] = [];
    for (const raw of rawList) {
        const snap = normalizeWbWarehouse(raw);
        if (!snap) continue;
        if (seen.has(snap.externalWarehouseId)) continue;
        seen.add(snap.externalWarehouseId);
        out.push(snap);
    }
    return out;
}
