export type StepKey =
    | 'welcome'
    | 'setup_company'
    | 'connect_marketplace'
    | 'add_products'
    | 'invite_team'
    | 'check_stocks';

export interface StepDef {
    key: StepKey;
    title: string;
    description: string;
    required: boolean;
    order: number;
    /** Ссылка для CTA-кнопки в виджете онбординга (null для информационных шагов без действия) */
    ctaLink: string | null;
    /** Domain event, при котором шаг автоматически помечается DONE (null = только user_action) */
    autoCompleteEvent: string | null;
}

export interface CatalogVersion {
    userBootstrap: StepDef[];
    tenantActivation: StepDef[];
}

export const STEP_CATALOG: Record<string, CatalogVersion> = {
    v1: {
        userBootstrap: [
            {
                key: 'welcome',
                title: 'Добро пожаловать',
                description: 'Познакомьтесь с возможностями платформы',
                required: false,
                order: 1,
                ctaLink: null,
                autoCompleteEvent: null,
            },
            {
                key: 'setup_company',
                title: 'Создайте компанию',
                description: 'Зарегистрируйте первую компанию для начала работы',
                required: false,
                order: 2,
                ctaLink: '/onboarding/create-company',
                autoCompleteEvent: 'tenant_created',
            },
        ],
        tenantActivation: [
            {
                key: 'connect_marketplace',
                title: 'Подключите маркетплейс',
                description: 'Добавьте API-ключи Wildberries или Ozon',
                required: false,
                order: 1,
                ctaLink: '/app/settings/marketplace',
                autoCompleteEvent: 'marketplace_account_connected',
            },
            {
                key: 'add_products',
                title: 'Загрузите каталог',
                description: 'Импортируйте или добавьте товары вручную',
                required: false,
                order: 2,
                ctaLink: '/app/catalog/import',
                autoCompleteEvent: 'first_product_created',
            },
            {
                key: 'invite_team',
                title: 'Пригласите команду',
                description: 'Добавьте коллег для совместной работы',
                required: false,
                order: 3,
                ctaLink: '/app/settings/team',
                autoCompleteEvent: 'first_invite_sent',
            },
            {
                key: 'check_stocks',
                title: 'Проверьте остатки',
                description: 'Убедитесь, что данные по складу корректны',
                required: false,
                order: 4,
                ctaLink: '/app/warehouse',
                autoCompleteEvent: null,
            },
        ],
    },
};

export const CURRENT_CATALOG_VERSION = 'v1';

export function getStepsForScope(
    scope: 'USER_BOOTSTRAP' | 'TENANT_ACTIVATION',
    version = CURRENT_CATALOG_VERSION,
): StepDef[] {
    const catalog = STEP_CATALOG[version] ?? STEP_CATALOG[CURRENT_CATALOG_VERSION];
    return scope === 'USER_BOOTSTRAP' ? catalog.userBootstrap : catalog.tenantActivation;
}
