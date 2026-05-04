import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronUp, CheckCircle, Circle, SkipForward, ExternalLink, Trophy } from 'lucide-react';
import { onboardingApi, type OnboardingState, type OnboardingStep } from '../api/onboarding';
import { S } from './ui';

const BLOCK_LABELS: Record<string, string> = {
    ROLE_INSUFFICIENT: 'Недостаточно прав для выполнения шагов',
    TRIAL_EXPIRED: 'Пробный период истёк. Оформите подписку.',
    TENANT_SUSPENDED: 'Доступ приостановлен.',
    TENANT_CLOSED: 'Компания закрыта.',
};

const BOTTOM_FIXED: React.CSSProperties = {
    position: 'fixed', bottom: 24, right: 24, zIndex: 50,
};

export default function OnboardingWidget() {
    const navigate = useNavigate();
    const [state, setState] = useState<OnboardingState | null>(null);
    const [loading, setLoading] = useState(true);
    const [isOpen, setIsOpen] = useState(true);
    const [showCongrats, setShowCongrats] = useState(false);

    useEffect(() => {
        onboardingApi.getState()
            .then((s) => {
                setState(s);
                if (s?.status === 'CLOSED') setIsOpen(false);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const handleClose = async () => {
        try { await onboardingApi.close(); } catch { /* non-fatal */ }
        setIsOpen(false);
        setState((prev) => prev ? { ...prev, status: 'CLOSED' } : prev);
    };

    const handleReopen = async () => {
        try {
            const s = await onboardingApi.reopen();
            if (s) setState(s);
        } catch { /* non-fatal */ }
        setIsOpen(true);
    };

    const handleComplete = async () => {
        try { await onboardingApi.complete(); } catch { /* non-fatal */ }
        setShowCongrats(true);
        setTimeout(() => { setShowCongrats(false); setState(null); }, 3000);
    };

    const handleCtaClick = async (step: OnboardingStep) => {
        if (step.isCtaBlocked || !step.ctaLink) return;
        try {
            const updated = await onboardingApi.updateStep(step.key, 'viewed');
            if (updated) setState(updated);
        } catch { /* non-fatal */ }
        navigate(step.ctaLink);
    };

    if (showCongrats) {
        return (
            <div style={{ ...BOTTOM_FIXED, background: S.green, color: '#fff', borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
                <Trophy size={15} style={{ flexShrink: 0 }} />
                <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600 }}>Настройка завершена!</span>
            </div>
        );
    }

    if (loading || !state || state.status === 'COMPLETED') return null;

    const { progress } = state;
    const completed = progress.done + progress.skipped;
    const progressPercent = progress.total > 0 ? Math.round((completed / progress.total) * 100) : 0;

    if (!isOpen) {
        return (
            <div style={BOTTOM_FIXED}>
                <button
                    onClick={handleReopen}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: S.blue, color: '#fff',
                        fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                        padding: '8px 16px', borderRadius: 999, border: 'none',
                        cursor: 'pointer', boxShadow: '0 4px 16px rgba(59,130,246,0.4)',
                    }}
                >
                    <span>Настройка {completed}/{progress.total}</span>
                    <ChevronUp size={14} />
                </button>
            </div>
        );
    }

    return (
        <div style={{
            ...BOTTOM_FIXED, width: 300,
            background: '#fff', borderRadius: 16,
            boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
            border: `1px solid ${S.border}`, overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${S.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink, margin: 0 }}>Настройка компании</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 999, height: 4 }}>
                            <div style={{ width: `${progressPercent}%`, height: 4, borderRadius: 999, background: S.blue, transition: 'width 0.3s ease' }} />
                        </div>
                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, flexShrink: 0 }}>{progressPercent}%</span>
                    </div>
                </div>
                <button
                    onClick={handleClose}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: S.muted, display: 'flex', flexShrink: 0 }}
                >
                    <X size={14} />
                </button>
            </div>

            {/* Block reason */}
            {state.isBlocked && state.blockReason && (
                <div style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.08)', borderBottom: `1px solid rgba(245,158,11,0.2)` }}>
                    <p style={{ fontFamily: 'Inter', fontSize: 11, color: S.amber, margin: 0 }}>
                        {BLOCK_LABELS[state.blockReason] ?? 'Действия ограничены'}
                    </p>
                </div>
            )}

            {/* Steps */}
            <div style={{ padding: '4px 0', maxHeight: 240, overflowY: 'auto' }}>
                {state.steps.map((step) => (
                    <StepRow key={step.key} step={step} onCtaClick={() => handleCtaClick(step)} />
                ))}
            </div>

            {/* Footer */}
            {!state.isBlocked && (
                <div style={{ padding: '8px 14px', borderTop: `1px solid ${S.border}` }}>
                    <button
                        onClick={handleComplete}
                        style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 11, color: S.muted }}
                        onMouseEnter={e => (e.currentTarget.style.color = S.sub)}
                        onMouseLeave={e => (e.currentTarget.style.color = S.muted)}
                    >
                        Пропустить настройку
                    </button>
                </div>
            )}
        </div>
    );
}

function StepRow({ step, onCtaClick }: { step: OnboardingStep; onCtaClick: () => void }) {
    const [hovered, setHovered] = useState(false);
    const isDone = step.status === 'DONE';
    const isSkipped = step.status === 'SKIPPED';
    const faded = isDone || isSkipped;

    return (
        <div
            style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
                background: !faded && hovered ? '#f8fafc' : 'transparent', transition: 'background 0.15s',
            }}
            onMouseEnter={() => !faded && setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div style={{ flexShrink: 0 }}>
                {isDone ? (
                    <CheckCircle size={15} color={S.green} />
                ) : isSkipped ? (
                    <SkipForward size={15} color={S.muted} />
                ) : (
                    <Circle size={15} color={S.muted} />
                )}
            </div>
            <p style={{
                flex: 1, fontFamily: 'Inter', fontSize: 12, margin: 0,
                color: faded ? S.muted : S.ink,
                textDecoration: faded ? 'line-through' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
                {step.title}
            </p>
            {!faded && !step.isCtaBlocked && step.ctaLink && (
                <button
                    onClick={onCtaClick}
                    style={{ flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, color: S.blue, display: 'flex' }}
                    title="Перейти"
                >
                    <ExternalLink size={12} />
                </button>
            )}
        </div>
    );
}
