import axios from 'axios';

export type Marketplace = 'WB' | 'OZON';

export async function fetchChannelVisibility(): Promise<Marketplace[]> {
    const res = await axios.get('/inventory/channel-visibility');
    return res.data.visibleMarketplaces ?? ['WB', 'OZON'];
}

export async function updateChannelVisibility(visibleMarketplaces: Marketplace[]): Promise<void> {
    await axios.patch('/inventory/channel-visibility', { visibleMarketplaces });
}
