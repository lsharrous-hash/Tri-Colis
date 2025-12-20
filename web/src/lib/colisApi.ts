import { api } from '../lib/api';

export interface Colis {
  id: number;
  tourId: number;
  code?: string;
  trackingNumber?: string;
  scanned?: boolean;
  scannedAt?: string | null;
}

export async function getColis(date?: string): Promise<Colis[]> {
  const { data } = await api.get<Colis[]>('/api/colis', {
    params: date ? { date } : {},
  });
  return data;
}
