import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/core/utils';

export interface KpiCardProProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down' | 'neutral';
  change?: string;
  changeLabel?: string;
  onClick?: () => void;
  className?: string;
  color?: 'blue' | 'emerald' | 'rose' | 'amber' | 'purple' | 'slate';
}

const colorMap = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-800/30',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    text: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-800/30',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    text: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-100 dark:bg-rose-800/30',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-100 dark:bg-amber-800/30',
  },
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    text: 'text-purple-600 dark:text-purple-400',
    iconBg: 'bg-purple-100 dark:bg-purple-800/30',
  },
  slate: {
    bg: 'bg-slate-50 dark:bg-slate-800/30',
    text: 'text-slate-600 dark:text-slate-400',
    iconBg: 'bg-slate-100 dark:bg-slate-700/30',
  },
};

const trendColors = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-slate-500 dark:text-slate-400',
};

export const KpiCardPro: React.FC<KpiCardProProps> = ({
  title,
  value,
  icon: Icon,
  trend = 'neutral',
  change,
  changeLabel,
  onClick,
  className,
  color = 'slate',
}) => {
  const colors = colorMap[color];
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 p-5 transition-all duration-200',
        onClick ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5' : '',
        colors.bg,
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
          {(change || changeLabel) && (
            <div className="flex items-center gap-1.5 mt-2">
              <TrendIcon size={14} className={trendColors[trend]} />
              <span className={cn('text-sm font-medium', trendColors[trend])}>
                {change && (trend === 'up' ? '+' : trend === 'down' ? '-' : '') + change}
              </span>
              {changeLabel && (
                <span className="text-xs text-slate-400 dark:text-slate-500">{changeLabel}</span>
              )}
            </div>
          )}
        </div>
        <div className={cn('w-11 h-11 rounded-lg flex items-center justify-center shrink-0', colors.iconBg)}>
          <Icon className={cn('w-5 h-5', colors.text)} />
        </div>
      </div>
    </div>
  );
};

export default KpiCardPro;
