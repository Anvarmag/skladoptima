import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronUp, CheckCircle, Circle, SkipForward, ExternalLink, Trophy } from 'lucide-react';
import { onboardingApi, OnboardingState, OnboardingStep } from '../api/onboarding';

const BLOCK_LABELS: Record<string, string> = {
    ROLE_INSUFFICIENT: 'Недостаточно прав для выполнения шагов',
    TRIAL_EXPIRED: 'Пробный период истёк. Оформите подписку.',
    TENANT_SUSPENDED: 'Доступ приостановлен.',
    TENANT_CLOSED: 'Компания закрыта.',
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
            <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 bg-green-500 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-2">
                <Trophy className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm font-medium">Настройка завершена!</span>
            </div>
        );
    }

    if (loading || !state || state.status === 'COMPLETED') return null;

    const { progress } = state;
    const completed = progress.done + progress.skipped;
    const progressPercent = progress.total > 0 ? Math.round((completed / progress.total) * 100) : 0;

    if (!isOpen) {
        return (
            <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50">
                <button
                    onClick={handleReopen}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg transition-colors"
                >
                    <span>Настройка {completed}/{progress.total}</span>
                    <ChevronUp className="h-4 w-4" />
                </button>
            </div>
        );
    }

    return (
        <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-80 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">Настройка компании</p>
                    <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                            <div
                                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                        <span className="text-xs text-slate-400 flex-shrink-0">{progressPercent}%</span>
                    </div>
                </div>
                <button onClick={handleClose} className="p-1 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Block reason banner */}
            {state.isBlocked && state.blockReason && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-100">
                    <p className="text-xs text-amber-700">{BLOCK_LABELS[state.blockReason] ?? 'Действия ограничены'}</p>
                </div>
            )}

            {/* Steps */}
            <div className="py-1 max-h-64 overflow-y-auto">
                {state.steps.map((step) => (
                    <StepRow key={step.key} step={step} onCtaClick={() => handleCtaClick(step)} />
                ))}
            </div>

            {/* Footer */}
            {!state.isBlocked && (
                <div className="px-4 py-2.5 border-t border-slate-100">
                    <button
                        onClick={handleComplete}
                        className="w-full text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        Пропустить настройку
                    </button>
                </div>
            )}
        </div>
    );
}

function StepRow({ step, onCtaClick }: { step: OnboardingStep; onCtaClick: () => void }) {
    const isDone = step.status === 'DONE';
    const isSkipped = step.status === 'SKIPPED';
    const faded = isDone || isSkipped;

    return (
        <div className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${faded ? '' : 'hover:bg-slate-50'}`}>
            <div className="flex-shrink-0">
                {isDone ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                ) : isSkipped ? (
                    <SkipForward className="h-4 w-4 text-slate-300" />
                ) : (
                    <Circle className="h-4 w-4 text-slate-300" />
                )}
            </div>
            <p className={`flex-1 text-sm min-w-0 truncate ${faded ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                {step.title}
            </p>
            {!faded && !step.isCtaBlocked && step.ctaLink && (
                <button
                    onClick={onCtaClick}
                    className="flex-shrink-0 p-1 text-blue-400 hover:text-blue-600 transition-colors"
                    title="Перейти"
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}
