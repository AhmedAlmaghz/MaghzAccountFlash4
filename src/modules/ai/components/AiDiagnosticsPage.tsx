import { useState } from 'react';
import { Play, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { Card } from '@/core/ui/components/Card';
import { Button } from '@/core/ui/components/Button';
import { PageLoader } from '@/core/ui/components/PageLoader';
import { runEvalHarness, type EvalReport } from '../eval/evalHarness';

/**
 * /ai/diagnostics — deterministic eval + diagnostics surface (audit 2026-11-07).
 * No provider calls: it gates the contracts that do not need an LLM key
 * (registry, dialect, numbers, hijri dates) so a regression fails loudly
 * in the UI, not silently in a chat.
 */
export const AiDiagnosticsPage = () => {
  const { t } = useTranslation();
  const [report, setReport] = useState<EvalReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      setReport(await runEvalHarness());
    } finally {
      setRunning(false);
    }
  };

  if (running) return <PageLoader />;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('ai.diagnostics.title', { default: 'تشخيص الوكيل والتقييم' })}</h1>
        <Button onClick={run} leftIcon={<Play size={16} />}>
          {t('ai.diagnostics.run', { default: 'تشغيل التقييم' })}
        </Button>
      </div>
      <Card>
        {report ? (
          <div className="space-y-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {report.passed}/{report.total} — {new Date(report.at).toLocaleString('ar-YE')}
            </p>
            {report.cases.map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-sm">
                {c.pass ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-600" /> : <XCircle size={16} className="mt-0.5 text-rose-600" />}
                <div>
                  <span className="font-medium">{c.id}</span>
                  <span className="text-zinc-500"> · {c.category} · {c.detail}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{t('ai.diagnostics.empty', { default: 'اضغط «تشغيل التقييم» لفحص العقود الحتمية (بدون استدعاء المزود).' })}</p>
        )}
      </Card>
    </div>
  );
};

export default AiDiagnosticsPage;
