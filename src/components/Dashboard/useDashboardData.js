import { usePluginData } from '@docusaurus/useGlobalData';

export function useDashboardData() {
  const data = usePluginData('river-dashboard');
  return (
    data ?? {
      generatedAt: '',
      totals: {},
      phases: [],
      skills: [],
      costTrend: [],
    }
  );
}
