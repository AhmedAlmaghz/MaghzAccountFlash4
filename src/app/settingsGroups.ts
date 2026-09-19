/**
 * Coherent groups for the (long) Settings section — every settings child
 * belongs to exactly one group. Shared by the sidebar (section headers) and
 * any future settings hub page. Keep in sync with `menuItems` in layout.tsx.
 */
export type SettingsGroupId = 'org' | 'finance' | 'inventory' | 'hr' | 'system';

export const SETTINGS_GROUPS: { id: SettingsGroupId; titleKey: string }[] = [
  { id: 'org', titleKey: 'settings.groups.org' },
  { id: 'finance', titleKey: 'settings.groups.finance' },
  { id: 'inventory', titleKey: 'settings.groups.inventory' },
  { id: 'hr', titleKey: 'settings.groups.hr' },
  { id: 'system', titleKey: 'settings.groups.system' },
];
