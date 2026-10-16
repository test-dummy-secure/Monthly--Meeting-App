import { useState, useEffect } from 'react';
import { fetchDashboardData } from '../api/dashboardApi';
import { useTenant } from '../context/TenantContext';

export function useDashboardData() {
  const { tenantId } = useTenant();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        setIsLoading(true);
        setIsError(false);
        const result = await fetchDashboardData(tenantId);
        if (isMounted) {
          setData(result);
        }
      } catch (err) {
        if (isMounted) {
          setIsError(true);
          setError(err.message || 'Failed to load dashboard data');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [tenantId]);

  return { data, isLoading, isError, error };
}
