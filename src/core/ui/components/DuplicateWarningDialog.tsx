import * as React from 'react';
import { AlertTriangle, XCircle, Search } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useTranslation } from '@/core/i18n/useTranslation';

export interface DuplicateCandidateDisplay {
  name: string;
  code?: string;
  score?: number;
}

export interface DuplicateWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** المتابعة رغم التشابه (للحالة near فقط) */
  onConfirm: () => void;
  /** الاسم المدخل */
  inputName: string;
  /** تسمية الكيان: عميل / مورد / موظف / منتج / حساب */
  entityLabel: string;
  /** سجل مطابق تماماً (واحد على الأكثر) */
  exactMatch?: DuplicateCandidateDisplay | null;
  /** سجلات مشابهة بدرجة عالية */
  nearMatches?: DuplicateCandidateDisplay[];
  /** هل وضع تعديل (يغير نص زر المتابعة) */
  isEdit?: boolean;
  /** وضع المستند — يستخدم مفاتيح duplicate.document.* */
  isDocument?: boolean;
}

/**
 * حوار تحذير التكرار — يغطي حالتين:
 * 1) exact: اسم مطابق تماماً بعد التطبيع → حظر (زر واحد: إلغاء)
 * 2) near: تشابه عالٍ ≥0.85 → تخيير (إلغاء / متابعة)
 *
 * تصميم عصري متوافق مع Modal + Tailwind + dark mode + RTL.
 */
export const DuplicateWarningDialog: React.FC<DuplicateWarningDialogProps> = React.memo(
  ({ isOpen, onClose, onConfirm, inputName, entityLabel, exactMatch, nearMatches, isEdit, isDocument }) => {
    const { t } = useTranslation();
    const isExact = !!exactMatch;
    const list = nearMatches ?? [];
    const i18nPrefix = isDocument ? 'duplicate.document' : 'duplicate';

    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="md"
        title={isExact ? t(`${i18nPrefix}.exactTitle`) : t(`${i18nPrefix}.nearTitle`)}
        description={isExact ? undefined : t(`${i18nPrefix}.nearSubtitle`)}
      >
        <div className="space-y-4">
          {/* Exact banner */}
          {isExact && exactMatch && (
            <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
              <XCircle size={20} className="shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-rose-800 dark:text-rose-200">
                  {t(`${i18nPrefix}.exactMessage`, { name: exactMatch.name, number: exactMatch.name })}
                </p>
                <p className="text-xs text-rose-700/80 dark:text-rose-300/80">
                  {t(`${i18nPrefix}.exactHint`)}
                </p>
                <div className="flex items-center gap-2 text-xs font-medium text-rose-700 dark:text-rose-300">
                  <span className="rounded-full bg-white px-2 py-0.5 dark:bg-slate-800">{entityLabel}</span>
                  <span>—</span>
                  <span className="font-bold">{exactMatch.name}</span>
                  {exactMatch.code && (
                    <>
                      <span>•</span>
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">{exactMatch.code}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Near header */}
          {!isExact && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
              <AlertTriangle size={20} className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  {t(`${i18nPrefix}.nearMessage`, { count: String(list.length), name: inputName })}
                </p>
                <p className="text-xs text-amber-800/70 dark:text-amber-200/70">
                  {t(`${i18nPrefix}.nearHint`)}
                </p>
              </div>
            </div>
          )}

          {/* Input summary */}
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <p className="text-[11px] font-semibold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
              {t(isDocument ? 'duplicate.document.inputLabel' : 'duplicate.fieldName')} • {entityLabel}
            </p>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-50 mt-1 flex items-center gap-2">
              <Search size={14} className="text-slate-400" />
              {inputName}
            </p>
          </div>

          {/* Near list */}
          {!isExact && list.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                {t('duplicate.similarRecords')} <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-700">{list.length}</span>
              </p>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {list.map((m, i) => (
                  <div key={`${m.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{m.name}</p>
                      {m.code && (
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{t('duplicate.code')}: {m.code}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        {Math.round((m.score ?? 0) * 100)}%
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">{t('duplicate.similarity')}</span>
                      <div className="h-1 w-16 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${Math.round((m.score ?? 0) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="secondary" onClick={onClose}>
              {isExact ? t('close') : t('cancel')}
            </Button>
            {!isExact && (
              <Button variant="primary" onClick={onConfirm}>
                {isEdit ? t('duplicate.proceedEdit') : t('duplicate.proceed')}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  },
);
DuplicateWarningDialog.displayName = 'DuplicateWarningDialog';
