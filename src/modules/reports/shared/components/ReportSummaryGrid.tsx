import { KpiCardPro } from '../../components/KpiCardPro';

export interface SummaryItem {
  key: string;
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: 'blue' | 'emerald' | 'rose' | 'amber' | 'purple' | 'slate';
  trend?: 'up' | 'down' | 'neutral';
  change?: string;
  changeLabel?: string;
  onClick?: () => void;
}

export function ReportSummaryGrid({ items }: { items: SummaryItem[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
      {items.map((item) => (
        <KpiCardPro key={item.key} title={item.title} value={item.value} icon={item.icon} color={item.color ?? 'slate'} trend={item.trend ?? 'neutral'} change={item.change} changeLabel={item.changeLabel} onClick={item.onClick} />
      ))}
    </div>
  );
}
