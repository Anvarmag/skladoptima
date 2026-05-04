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

const STYLES: Record<string, { bg: string; border: string; color: string }> = {
    info:    { bg: 'rgba(59,130,246,0.06)',  border: 'rgba(59,130,246,0.25)',  color: '#1e40af' },
    warning: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)',   color: '#92400e' },
    error:   { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',   color: '#991b1b' },
};

const ICONS = { info: Info, warning: AlertTriangle, error: XCircle };

export default function AccessStateBanner({ accessState }: { accessState: string }) {
    const config = BANNER_CONFIG[accessState];
    if (!config) return null;

    const Icon = ICONS[config.severity];
    const st = STYLES[config.severity];

    return (
        <div style={{
            background: st.bg, border: `1px solid ${st.border}`, borderRadius: 10,
            padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 10,
            fontFamily: 'Inter', fontSize: 13, color: st.color,
        }}>
            <Icon size={15} style={{ marginTop: 1, flexShrink: 0 }} />
            <div>
                <span style={{ fontWeight: 600 }}>{config.message}</span>
                {' '}
                <span>{config.actions}</span>
            </div>
        </div>
    );
}
