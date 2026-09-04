import React, { useMemo, useState } from 'react';
import { Palette, Plus, Pencil, Trash2, Check, Sun, Moon, Sparkles } from 'lucide-react';
import {
  Card,
  Button,
  Modal,
  Input,
  ConfirmDialog,
  Can,
  PageHeader,
} from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import {
  BRAND_EMERALD,
  BRAND_GOLD,
  BRAND_CHARCOAL,
  BRAND_CHARCOAL_SURFACE,
  BUILT_IN_THEMES,
  FONT_STACKS,
  generateScale,
  isValidHex,
  normalizeHex,
  themeDisplayName,
  withThemeDefaults,
  type ThemeDefinition,
  type ThemeFont,
  type ThemeMode,
} from '@/core/theme/themes';

interface ThemeForm {
  nameAr: string;
  nameEn: string;
  mode: ThemeMode;
  primary: string;
  accent: string;
  background: string;
  surface: string;
  sidebarBg: string;
  headerBg: string;
  navText: string;
  navActive: string;
  navIcon: string;
  font: ThemeFont;
}

const defaultForm = (mode: ThemeMode): ThemeForm => {
  const dark = mode === 'dark';
  return {
    nameAr: '',
    nameEn: '',
    mode,
    primary: dark ? '#14B58A' : BRAND_EMERALD,
    accent: BRAND_GOLD,
    background: dark ? BRAND_CHARCOAL : '#F7FAF8',
    surface: dark ? BRAND_CHARCOAL_SURFACE : '#FFFFFF',
    sidebarBg: dark ? BRAND_CHARCOAL : '#FFFFFF',
    headerBg: dark ? BRAND_CHARCOAL : '#FFFFFF',
    navText: dark ? '#D4D4D8' : '#52525B',
    navActive: dark ? '#14B58A' : BRAND_EMERALD,
    navIcon: dark ? '#A1A1AA' : '#71717A',
    font: 'cairo',
  };
};

function newThemeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `custom-${crypto.randomUUID()}`;
  return `custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

const ThemePreview: React.FC<{ def: ThemeDefinition; active: boolean }> = ({ def, active }) => {
  const scale = useMemo(() => generateScale(def.primary), [def.primary]);
  const { t, language } = useTranslation();
  // Runtime guards: themes stored before the interface tokens existed.
  const full = withThemeDefaults(def);
  return (
    <div
      className="rounded-xl border-2 overflow-hidden transition-all"
      style={{ borderColor: active ? full.primary : undefined }}
    >
      <div className="flex" style={{ fontFamily: FONT_STACKS[full.font] }}>
        {/* Mini sidebar */}
        <div className="w-14 shrink-0 p-1.5 space-y-1.5" style={{ background: full.sidebarBg }}>
          <span className="block h-4 rounded" style={{ background: full.navActive }} />
          <span className="block h-4 rounded opacity-70" style={{ background: full.navIcon }} />
          <span className="block h-4 rounded opacity-70" style={{ background: full.navIcon }} />
          <span className="block text-[8px] font-bold truncate" style={{ color: full.navText }}>
            {themeDisplayName(full, language)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: full.headerBg }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f43f5e' }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: full.accent }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: full.primary }} />
          </div>
          <div className="p-3 space-y-2" style={{ background: full.surface }}>
            <div
              className="h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${full.primary}, ${scale['700']})` }}
            >
              {t('settings.themes.previewButton')}
            </div>
            <div className="flex gap-1.5">
              <span className="h-4 flex-1 rounded" style={{ background: full.primary }} />
              <span className="h-4 flex-1 rounded" style={{ background: full.accent }} />
              <span className="h-4 flex-1 rounded border" style={{ background: full.background }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ label, value, onChange }) => (
  <div>
    <label className="form-label block mb-1.5">{label}</label>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={isValidHex(value) ? normalizeHex(value, '#000000') : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="w-11 h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer bg-transparent p-1"
        aria-label={label}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#0B7A5E"
        className="font-mono"
      />
    </div>
  </div>
);

export const ThemeSettingsPage: React.FC = () => {
  const { t, language } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const themeId = useAppStore((s) => s.themeId);
  const customThemes = useAppStore((s) => s.customThemes);
  const setThemeId = useAppStore((s) => s.setThemeId);
  const addCustomTheme = useAppStore((s) => s.addCustomTheme);
  const updateCustomTheme = useAppStore((s) => s.updateCustomTheme);
  const deleteCustomTheme = useAppStore((s) => s.deleteCustomTheme);

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<ThemeForm>(() => defaultForm('light'));

  const allThemes = useMemo(
    () => [...BUILT_IN_THEMES, ...customThemes],
    [customThemes],
  );

  const reset = (mode: ThemeMode = 'light') => {
    setForm(defaultForm(mode));
    setEditingId(null);
  };

  const openEdit = (def: ThemeDefinition) => {
    const full = withThemeDefaults(def);
    setForm({
      nameAr: full.nameAr,
      nameEn: full.nameEn,
      mode: full.mode,
      primary: full.primary,
      accent: full.accent,
      background: full.background,
      surface: full.surface,
      sidebarBg: full.sidebarBg,
      headerBg: full.headerBg,
      navText: full.navText,
      navActive: full.navActive,
      navIcon: full.navIcon,
      font: full.font,
    });
    setEditingId(def.id);
    setIsOpen(true);
  };

  const handleSave = () => {
    if (!form.nameAr.trim() || !form.nameEn.trim()) {
      addToast('error', t('settings.themes.nameRequired'));
      return;
    }
    for (const [key, val] of Object.entries({
      primary: form.primary,
      accent: form.accent,
      background: form.background,
      surface: form.surface,
      sidebarBg: form.sidebarBg,
      headerBg: form.headerBg,
      navText: form.navText,
      navActive: form.navActive,
      navIcon: form.navIcon,
    })) {
      if (!isValidHex(val)) {
        addToast('error', t('settings.themes.invalidColor', { field: key }));
        return;
      }
    }
    const def: ThemeDefinition = {
      id: editingId ?? newThemeId(),
      nameAr: form.nameAr.trim(),
      nameEn: form.nameEn.trim(),
      mode: form.mode,
      primary: normalizeHex(form.primary, BRAND_EMERALD),
      accent: normalizeHex(form.accent, BRAND_GOLD),
      background: normalizeHex(form.background, '#ffffff'),
      surface: normalizeHex(form.surface, '#ffffff'),
      sidebarBg: normalizeHex(form.sidebarBg, '#ffffff'),
      headerBg: normalizeHex(form.headerBg, '#ffffff'),
      navText: normalizeHex(form.navText, '#52525b'),
      navActive: normalizeHex(form.navActive, BRAND_EMERALD),
      navIcon: normalizeHex(form.navIcon, '#71717a'),
      font: form.font,
    };
    if (editingId) {
      updateCustomTheme(editingId, def);
      addToast('success', t('settings.themes.updated'));
    } else {
      addCustomTheme(def);
      addToast('success', t('settings.themes.created'));
    }
    setIsOpen(false);
    reset();
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteCustomTheme(deleteId);
    addToast('success', t('settings.themes.deleted'));
    setDeleteId(null);
  };

  const builtIns = allThemes.filter((d) => BUILT_IN_THEMES.some((b) => b.id === d.id));
  const customs = allThemes.filter((d) => !BUILT_IN_THEMES.some((b) => b.id === d.id));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t('settings.themes.title')}
        subtitle={t('settings.themes.subtitle')}
        icon={<Palette size={22} />}
        actions={
          <Can action="create" module="settings">
            <Button
              variant="primary"
              leftIcon={<Plus size={16} />}
              onClick={() => {
                reset('light');
                setIsOpen(true);
              }}
            >
              {t('settings.themes.newTheme')}
            </Button>
          </Can>
        }
      />

      {/* Built-in identity themes */}
      <div>
        <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-2 flex items-center gap-2">
          <Sparkles size={15} className="text-gold-500" />
          {t('settings.themes.builtIn')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {builtIns.map((def) => {
            const active = themeId === def.id;
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => setThemeId(def.id)}
                className="text-start rounded-xl transition-transform hover:scale-[1.01] focus-visible:outline-2"
                aria-pressed={active}
              >
                <Card className={active ? 'ring-2 ring-brand border-transparent' : undefined}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      {def.mode === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                      {themeDisplayName(def, language)}
                    </div>
                    {active && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 dark:text-primary-400">
                        <Check size={14} />
                        {t('settings.themes.active')}
                      </span>
                    )}
                  </div>
                  <ThemePreview def={def} active={active} />
                </Card>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom themes */}
      <div>
        <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-2">
          {t('settings.themes.custom')}
        </h3>
        {customs.length === 0 ? (
          <Card className="text-center py-8 text-sm text-zinc-500 dark:text-zinc-400">
            {t('settings.themes.emptyMessage')}
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {customs.map((def) => {
              const active = themeId === def.id;
              return (
                <Card key={def.id} className={active ? 'ring-2 ring-brand border-transparent' : undefined}>
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => setThemeId(def.id)}
                      className="font-semibold text-sm hover:text-primary-600 dark:hover:text-primary-400"
                    >
                      {themeDisplayName(def, language)}
                      {active && (
                        <span className="ms-2 inline-flex items-center gap-1 text-xs font-bold text-primary-600 dark:text-primary-400">
                          <Check size={14} />
                          {t('settings.themes.active')}
                        </span>
                      )}
                    </button>
                    <div className="flex gap-1">
                      <Can action="edit" module="settings">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(def)} leftIcon={<Pencil size={14} />} aria-label={t('settings.themes.editTheme')} />
                      </Can>
                      <Can action="delete" module="settings">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteId(def.id)}
                          leftIcon={<Trash2 size={14} className="text-rose-500" />}
                          aria-label={t('settings.themes.deleteTheme')}
                        />
                      </Can>
                    </div>
                  </div>
                  <button type="button" onClick={() => setThemeId(def.id)} className="w-full text-start" aria-pressed={active}>
                    <ThemePreview def={def} active={active} />
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {isOpen && (
        <Modal
          isOpen={isOpen}
          title={editingId ? t('settings.themes.editTheme') : t('settings.themes.newTheme')}
          onClose={() => setIsOpen(false)}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label={t('settings.themes.nameAr')}
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              />
              <Input
                label={t('settings.themes.nameEn')}
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label block mb-1.5">{t('settings.themes.mode')}</label>
              <div className="grid grid-cols-2 gap-2">
                {(['light', 'dark'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm({ ...form, mode: m })}
                    aria-pressed={form.mode === m}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-semibold transition-all ${
                      form.mode === m
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-500'
                    }`}
                  >
                    {m === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                    {t(m === 'dark' ? 'settings.themes.dark' : 'settings.themes.light')}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ColorField label={t('settings.themes.primary')} value={form.primary} onChange={(v) => setForm({ ...form, primary: v })} />
              <ColorField label={t('settings.themes.accent')} value={form.accent} onChange={(v) => setForm({ ...form, accent: v })} />
              <ColorField label={t('settings.themes.background')} value={form.background} onChange={(v) => setForm({ ...form, background: v })} />
              <ColorField label={t('settings.themes.surface')} value={form.surface} onChange={(v) => setForm({ ...form, surface: v })} />
            </div>
            <div>
              <p className="form-label mb-1.5">{t('settings.themes.interfaceColors')}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ColorField label={t('settings.themes.sidebarBg')} value={form.sidebarBg} onChange={(v) => setForm({ ...form, sidebarBg: v })} />
                <ColorField label={t('settings.themes.headerBg')} value={form.headerBg} onChange={(v) => setForm({ ...form, headerBg: v })} />
                <ColorField label={t('settings.themes.navText')} value={form.navText} onChange={(v) => setForm({ ...form, navText: v })} />
                <ColorField label={t('settings.themes.navActive')} value={form.navActive} onChange={(v) => setForm({ ...form, navActive: v })} />
                <ColorField label={t('settings.themes.navIcon')} value={form.navIcon} onChange={(v) => setForm({ ...form, navIcon: v })} />
              </div>
            </div>
            <div>
              <label className="form-label block mb-1.5" htmlFor="theme-font-select">
                {t('settings.themes.font')}
              </label>
              <select
                id="theme-font-select"
                className="form-control"
                value={form.font}
                onChange={(e) => setForm({ ...form, font: e.target.value as ThemeFont })}
              >
                {(Object.keys(FONT_STACKS) as ThemeFont[]).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: FONT_STACKS[f] }}>
                    {t(`settings.themes.font_${f}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="form-label mb-1.5">{t('settings.themes.livePreview')}</p>
              <ThemePreview
                def={{
                  id: 'preview',
                  nameAr: form.nameAr || '—',
                  nameEn: form.nameEn || '—',
                  mode: form.mode,
                  primary: isValidHex(form.primary) ? form.primary : BRAND_EMERALD,
                  accent: isValidHex(form.accent) ? form.accent : BRAND_GOLD,
                  background: isValidHex(form.background) ? form.background : '#ffffff',
                  surface: isValidHex(form.surface) ? form.surface : '#ffffff',
                  sidebarBg: isValidHex(form.sidebarBg) ? form.sidebarBg : '#ffffff',
                  headerBg: isValidHex(form.headerBg) ? form.headerBg : '#ffffff',
                  navText: isValidHex(form.navText) ? form.navText : '#52525b',
                  navActive: isValidHex(form.navActive) ? form.navActive : BRAND_EMERALD,
                  navIcon: isValidHex(form.navIcon) ? form.navIcon : '#71717a',
                  font: form.font,
                }}
                active={false}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                {t('settings.common.cancel')}
              </Button>
              <Button onClick={handleSave} leftIcon={<Check size={16} />}>
                {t('settings.common.save')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('settings.themes.deleteTitle')}
        message={t('settings.themes.deleteMessage')}
        confirmText={t('settings.common.delete')}
        variant="danger"
      />
    </div>
  );
};

export default ThemeSettingsPage;
