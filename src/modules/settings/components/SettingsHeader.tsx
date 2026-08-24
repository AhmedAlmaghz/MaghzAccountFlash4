import React from 'react';
import { Layers } from 'lucide-react';

interface SettingsHeaderProps {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  /** Tailwind gradient classes, e.g. 'from-amber-600 via-amber-500 to-yellow-600' */
  color?: string;
  /** Optional action node (e.g. create button wrapped in <Can>) */
  action?: React.ReactNode;
}

/**
 * Shared gradient page header for Settings sub-pages.
 * Keeps the visual language of the module hubs while staying DRY.
 */
export const SettingsHeader: React.FC<SettingsHeaderProps> = ({
  title,
  subtitle,
  icon: Icon,
  color = 'from-slate-700 via-slate-600 to-slate-500',
  action,
}) => (
  <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${color} shadow-xl`}>
    <div className="absolute top-0 right-0 w-40 h-40 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
    <div className="absolute bottom-0 left-0 w-20 h-20 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
    <div className="relative px-6 py-8 sm:px-8 text-white">
      <div className="flex items-center gap-3 mb-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
          <Layers size={12} /> {title}
        </span>
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-1 flex items-center gap-2.5">
            <Icon size={26} className="shrink-0" />
            {title}
          </h2>
          <p className="text-white/80 text-base max-w-lg">{subtitle}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  </div>
);
