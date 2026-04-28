import { WarehouseType, WarehouseSourceMarketplace } from '@prisma/client';

/**
 * Канонический DTO внешнего склада, к которому приводятся все ответы
 * marketplace API. На вход sync use-case'а попадает массив таких объектов
 * (после нормализации), и upsert-логика работает только с этой моделью.
 */
export type WarehouseSnapshot = {
    externalWarehouseId: string;
    name: string;
    city?: string | null;
    warehouseType: WarehouseType;
    sourceMarketplace: WarehouseSourceMarketplace;
};
