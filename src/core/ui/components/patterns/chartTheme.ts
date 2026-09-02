/** Theme-aware chart palette/axis helpers — shared by ChartCard and charts.tsx. */

const FALLBACK_COLORS = ['#0d9488', '#e8940e', '#6366f1', '#0ea5e9', '#ec4899', '#22c55e', '#8b5cf6', '#f43f5e'];

/** Reads the theme-aware chart palette from CSS variables. */
export function getChartColors(): string[] {
  if (typeof window === 'undefined') {
    return FALLBACK_COLORS;
  }
  const styles = getComputedStyle(document.documentElement);
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
    const v = styles.getPropertyValue(`--chart-${i}`).trim();
    return v || FALLBACK_COLORS[i - 1];
  });
}

/** Theme-aware axis/grid colors for Recharts. */
export function getChartTheme(): { grid: string; text: string } {
  if (typeof window === 'undefined') {
    return { grid: '#e4e4e7', text: '#71717a' };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    grid: styles.getPropertyValue('--chart-grid').trim() || '#e4e4e7',
    text: styles.getPropertyValue('--chart-text').trim() || '#71717a',
  };
}
