import React from 'react';

interface PageLoaderProps {
  text?: string;
  fullPage?: boolean;
}

export const PageLoader: React.FC<PageLoaderProps> = ({ text, fullPage = true }) => {
  const containerClass = fullPage
    ? 'flex items-center justify-center h-full w-full'
    : 'flex items-center justify-center py-12';

  return (
    <div className={containerClass}>
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        {text && <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>}
      </div>
    </div>
  );
};
