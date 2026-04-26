import axios from 'axios';

export interface OnboardingStep {
    key: string;
    title: string;
    description?: string | null;
    required: boolean;
    ctaLink?: string | null;
    autoCompleteEvent?: string | null;
    status: 'PENDING' | 'VIEWED' | 'DONE' | 'SKIPPED';
    isCtaBlocked: boolean;
    completedAt?: string | null;
    skippedAt?: string | null;
    viewedAt?: string | null;
}

export interface OnboardingState {
    scope: 'USER_BOOTSTRAP' | 'TENANT_ACTIVATION';
    status: 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
    catalogVersion: string;
    lastStepKey: string | null;
    completedAt: string | null;
    closedAt: string | null;
    progress: { total: number; done: number; skipped: number };
    nextRecommendedStep: string | null;
    isBlocked: boolean;
    blockReason: string | null;
    steps: OnboardingStep[];
}

export const onboardingApi = {
    getState: async (): Promise<OnboardingState | null> => {
        const { data } = await axios.get('/onboarding/state');
        return data.state;
    },

    start: async (): Promise<OnboardingState | null> => {
        const { data } = await axios.post('/onboarding/start');
        return data.state;
    },

    updateStep: async (
        stepKey: string,
        status: 'viewed' | 'done' | 'skipped',
    ): Promise<OnboardingState | null> => {
        const { data } = await axios.patch(`/onboarding/steps/${stepKey}`, { status });
        return data.state;
    },

    close: async (): Promise<void> => {
        await axios.post('/onboarding/close');
    },

    reopen: async (): Promise<OnboardingState | null> => {
        const { data } = await axios.post('/onboarding/reopen');
        return data.state;
    },

    complete: async (): Promise<void> => {
        await axios.post('/onboarding/complete');
    },
};
