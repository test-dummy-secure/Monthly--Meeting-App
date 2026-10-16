import { api } from '../services/api';

export async function fetchDashboardData(tenantId) {
  const response = await api.analytics.get(tenantId);
  return response;
}
