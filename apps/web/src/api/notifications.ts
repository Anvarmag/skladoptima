import axios from 'axios';

export interface InboxItem {
    id: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
    readAt: string | null;
}

export interface InboxResponse {
    items: InboxItem[];
    unreadCount: number;
    hasMore: boolean;
    nextCursor: string | null;
}

export interface ChannelPrefs {
    email: boolean;
    in_app: boolean;
    telegram: boolean;
    max: boolean;
}

export interface CategoryPrefs {
    auth: boolean;
    billing: boolean;
    sync: boolean;
    inventory: boolean;
    referral: boolean;
    system: boolean;
}

export interface NotificationPreferences {
    tenantId: string;
    channels: ChannelPrefs;
    categories: CategoryPrefs;
    primaryChannel: string;
    isDefault: boolean;
    updatedAt: string | null;
}

export const notificationsApi = {
    getInbox: async (params?: {
        limit?: number;
        cursor?: string;
        unreadOnly?: boolean;
    }): Promise<InboxResponse> => {
        const { data } = await axios.get('/notifications', { params });
        return data;
    },

    markRead: async (id: string): Promise<void> => {
        await axios.patch(`/notifications/${id}/read`);
    },

    getPreferences: async (): Promise<NotificationPreferences> => {
        const { data } = await axios.get('/notifications/preferences');
        return data;
    },

    updatePreferences: async (payload: {
        channels?: Partial<ChannelPrefs>;
        categories?: Partial<CategoryPrefs>;
    }): Promise<NotificationPreferences> => {
        const { data } = await axios.patch('/notifications/preferences', payload);
        return data;
    },
};
