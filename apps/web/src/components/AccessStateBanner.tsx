import { AlertTriangle, XCircle, Info } from 'lucide-react';

interface BannerConfig {
    severity: 'info' | 'warning' | 'error';
    message: string;
    actions: string;
}

const BANNER_CONFIG: Record<string, BannerConfig> = {
    TRIAL_EXPIRED: {
        severity: 'error',
        message: 'Пробный период истёк. Компания переведена в режим только для чтения.',
        actions: 'Оформите подписку для продолжения работы.',
    },
    GRACE_PERIOD: {
        severity: 'warning',
        message: 'Платёж просрочен. Действует льготный период доступа.',
        actions: 'Обновите подписку, чтобы избежать блокировки.',
    },
    SUSPENDED: {
        severity: 'error',
        message: 'Доступ приостановлен. Запись данных заблокирована.',
        actions: 'Обратитесь в службу поддержки или обновите подписку.',
    },
    CLOSED: {
        severity: 'error',
        message: 'Компания закрыта. Доступ к данным недоступен.',
        actions: 'Обратитесь в службу поддержки.',
    },
};

const STYLES = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800',
};

const ICONS = {
    info: Info,
    warning: AlertTriangle,
    error: XCircle,
};

export default function AccessStateBanner({ accessState }: { accessState: string }) {
    const config = BANNER_CONFIG[accessState];
    if (!config) return null;

    const Icon = ICONS[config.severity];

    return (
        <div className={`border rounded-md px-4 py-3 flex items-start gap-3 text-sm ${STYLES[config.severity]}`}>
            <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
                <span className="font-medium">{config.message}</span>
                {' '}
                <span>{config.actions}</span>
            </div>
        </div>
    );
}
