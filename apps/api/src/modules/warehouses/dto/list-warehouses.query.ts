// Query-параметры для GET /warehouses. Все поля опциональны и приходят как
// строки — преобразование в enum/boolean делает контроллер.

export type ListWarehousesQuery = {
    page?: string;
    limit?: string;
    marketplaceAccountId?: string;
    sourceMarketplace?: string;
    warehouseType?: string;
    status?: string;
    search?: string;
};
