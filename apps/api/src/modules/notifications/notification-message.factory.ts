import { NotificationCategory, NotificationSeverity } from '@prisma/client';

export interface NotificationMessage {
    title: string;
    body: string;
}

/**
 * Генерирует человекочитаемые title/body для in-app inbox и email.
 *
 * MVP: шаблонный подход по (category, severity, payload.eventType).
 * В TASK_NOTIFICATIONS_6 frontend получает полный payload и рендерит
 * нотификации самостоятельно. Здесь — минимальный viable текст для
 * inbox и email subject/body.
 *
 * `payload.eventType` — опциональный машинный код события внутри категории,
 * позволяющий выбрать более конкретный шаблон (например, `SYNC_RUN_FAILED`
 * внутри категории SYNC).
 */
export function buildNotificationMessage(
    category: NotificationCategory,
    severity: NotificationSeverity,
    payload?: Record<string, unknown> | null,
): NotificationMessage {
    const eventType = (payload?.eventType as string | undefined) ?? '';

    switch (category) {
        case NotificationCategory.AUTH:
            return buildAuthMessage(eventType);
        case NotificationCategory.BILLING:
            return buildBillingMessage(severity, eventType, payload);
        case NotificationCategory.SYNC:
            return buildSyncMessage(severity, eventType, payload);
        case NotificationCategory.INVENTORY:
            return buildInventoryMessage(severity, eventType, payload);
        case NotificationCategory.REFERRAL:
            return buildReferralMessage(eventType, payload);
        case NotificationCategory.SYSTEM:
            return buildSystemMessage(severity, eventType);
        default:
            return {
                title: 'Новое уведомление',
                body: 'У вас есть новое уведомление от системы Складоптима.',
            };
    }
}

function buildAuthMessage(eventType: string): NotificationMessage {
    switch (eventType) {
        case 'EMAIL_VERIFICATION':
            return {
                title: 'Подтвердите email',
                body: 'Для завершения регистрации перейдите по ссылке в письме.',
            };
        case 'PASSWORD_RESET':
            return {
                title: 'Сброс пароля',
                body: 'Получен запрос на сброс пароля. Если это были не вы — немедленно смените пароль.',
            };
        case 'NEW_LOGIN':
            return {
                title: 'Новый вход в аккаунт',
                body: 'Выполнен вход в ваш аккаунт с нового устройства или браузера.',
            };
        case 'TEAM_INVITE':
            return {
                title: 'Приглашение в команду',
                body: 'Вас пригласили в компанию на платформе Складоптима.',
            };
        default:
            return {
                title: 'Уведомление безопасности',
                body: 'Зафиксировано событие безопасности в вашем аккаунте.',
            };
    }
}

function buildBillingMessage(
    severity: NotificationSeverity,
    eventType: string,
    payload?: Record<string, unknown> | null,
): NotificationMessage {
    switch (eventType) {
        case 'TRIAL_ENDING':
            return {
                title: 'Пробный период заканчивается',
                body: `Ваш пробный период скоро истечёт. Подключите тариф, чтобы продолжить работу.`,
            };
        case 'TRIAL_EXPIRED':
            return {
                title: 'Пробный период истёк',
                body: 'Пробный период завершён. Подключите тариф для продолжения работы.',
            };
        case 'PAYMENT_FAILED':
            return {
                title: 'Ошибка оплаты',
                body: 'Не удалось обработать платёж. Проверьте платёжные данные.',
            };
        case 'GRACE_PERIOD':
            return {
                title: 'Льготный период',
                body: 'Аккаунт переведён в льготный период. Оплатите подписку, чтобы не потерять доступ.',
            };
        case 'SUBSCRIPTION_SUSPENDED':
            return {
                title: 'Аккаунт приостановлен',
                body: 'Доступ к аккаунту ограничен из-за неоплаченной подписки.',
            };
        default:
            return {
                title: severity === NotificationSeverity.CRITICAL
                    ? 'Критическое уведомление биллинга'
                    : 'Уведомление о подписке',
                body: 'Получено уведомление по вашей подписке. Откройте раздел биллинга для деталей.',
            };
    }
}

function buildSyncMessage(
    severity: NotificationSeverity,
    eventType: string,
    payload?: Record<string, unknown> | null,
): NotificationMessage {
    const accountName = (payload?.accountName as string | undefined) ?? 'маркетплейс';
    switch (eventType) {
        case 'SYNC_RUN_FAILED':
            return {
                title: 'Ошибка синхронизации',
                body: `Синхронизация с ${accountName} завершилась с ошибкой.`,
            };
        case 'SYNC_RUN_PARTIAL':
            return {
                title: 'Частичная синхронизация',
                body: `Синхронизация с ${accountName} завершена частично. Проверьте ошибки.`,
            };
        case 'CREDENTIALS_INVALID':
            return {
                title: 'Требуется переподключение',
                body: `Токен доступа к ${accountName} недействителен. Обновите API-ключ.`,
            };
        default:
            return {
                title: severity === NotificationSeverity.CRITICAL
                    ? 'Критическая ошибка синхронизации'
                    : 'Событие синхронизации',
                body: `Получено уведомление по синхронизации с ${accountName}.`,
            };
    }
}

function buildInventoryMessage(
    severity: NotificationSeverity,
    eventType: string,
    payload?: Record<string, unknown> | null,
): NotificationMessage {
    const productName = (payload?.productName as string | undefined) ?? 'товар';
    switch (eventType) {
        case 'LOW_STOCK':
            return {
                title: 'Низкий остаток',
                body: `Остаток товара «${productName}» опустился ниже порогового значения.`,
            };
        case 'OUT_OF_STOCK':
            return {
                title: 'Товар закончился',
                body: `Товар «${productName}» закончился на складе.`,
            };
        case 'STOCK_CONFLICT':
            return {
                title: 'Конфликт остатков',
                body: `Обнаружено расхождение данных по товару «${productName}». Требуется проверка.`,
            };
        default:
            return {
                title: 'Уведомление склада',
                body: 'Получено уведомление по остаткам товаров.',
            };
    }
}

function buildReferralMessage(
    eventType: string,
    payload?: Record<string, unknown> | null,
): NotificationMessage {
    switch (eventType) {
        case 'REWARD_CREDITED':
            return {
                title: 'Бонус начислен',
                body: 'Вам начислены реферальные бонусы. Проверьте баланс в разделе рефералов.',
            };
        case 'REFERRAL_REGISTERED':
            return {
                title: 'Новый реферал',
                body: 'По вашей реферальной ссылке зарегистрировался новый пользователь.',
            };
        default:
            return {
                title: 'Реферальная программа',
                body: 'Получено уведомление по реферальной программе.',
            };
    }
}

function buildSystemMessage(
    severity: NotificationSeverity,
    eventType: string,
): NotificationMessage {
    switch (eventType) {
        case 'MAINTENANCE':
            return {
                title: 'Техническое обслуживание',
                body: 'Запланированы технические работы. Сервис может быть временно недоступен.',
            };
        case 'PLATFORM_INCIDENT':
            return {
                title: 'Инцидент на платформе',
                body: 'Зафиксирована техническая проблема на платформе. Команда работает над устранением.',
            };
        default:
            return {
                title: severity === NotificationSeverity.CRITICAL
                    ? 'Критическое системное уведомление'
                    : 'Системное уведомление',
                body: 'Получено системное уведомление от платформы Складоптима.',
            };
    }
}
