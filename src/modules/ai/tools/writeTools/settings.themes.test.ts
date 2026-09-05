import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/core/store';
import { settingsWriteTools } from './settings';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

function findTool(name: string) {
  const tool = settingsWriteTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

beforeEach(() => {
  // Isolate theme state: themes persist to localStorage in jsdom.
  useAppStore.setState({ themeId: 'emerald-light', customThemes: [] });
});

describe('settings.*_theme tools', () => {
  it('lists built-in and custom themes with the active marker', async () => {
    const res = (await findTool('settings.list_themes').execute({}, ctx)) as Record<string, unknown>;
    expect(res.activeThemeId).toBe('emerald-light');
    expect(res.builtIn as unknown[]).toHaveLength(2);
    expect(res.custom as unknown[]).toHaveLength(0);
  });

  it('generate_theme creates, validates, and activates', async () => {
    const tool = findTool('settings.generate_theme');
    const res = (await tool.execute({ nameAr: 'محيطي داكن', mode: 'dark', style: 'ocean' }, ctx)) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(res.activated).toBe(true);
    expect(String(res.id)).toMatch(/^custom-/);
    expect(useAppStore.getState().themeId).toBe(res.id);
    expect(useAppStore.getState().customThemes).toHaveLength(1);
  });

  it('create_theme rejects invalid hex and requires a name', async () => {
    const tool = findTool('settings.create_theme');
    const noName = (await tool.execute({}, ctx)) as Record<string, unknown>;
    expect(noName.error).toMatch(/nameAr/);
    const badHex = (await tool.execute({ nameAr: 'X', primary: 'red' }, ctx)) as Record<string, unknown>;
    expect(badHex.error).toMatch(/primary/);
  });

  it('update_theme protects built-ins and patches customs', async () => {
    const update = findTool('settings.update_theme');
    const blocked = (await update.execute({ themeId: 'emerald-dark', primary: '#000000' }, ctx)) as Record<string, unknown>;
    expect(blocked.error).toMatch(/محمية/);

    const gen = (await findTool('settings.generate_theme').execute({ nameAr: 'Y', mode: 'light' }, ctx)) as Record<string, unknown>;
    const ok = (await update.execute({ themeId: gen.id, primary: '#123456' }, ctx)) as Record<string, unknown>;
    expect(ok.updated).toBe(true);
    const stored = useAppStore.getState().customThemes.find((t) => t.id === gen.id);
    expect(stored?.primary).toBe('#123456');
  });

  it('activate_theme switches and rejects unknown ids', async () => {
    const activate = findTool('settings.activate_theme');
    const ok = (await activate.execute({ themeId: 'emerald-dark' }, ctx)) as Record<string, unknown>;
    expect(ok.activated).toBe(true);
    expect(useAppStore.getState().themeId).toBe('emerald-dark');
    const missing = (await activate.execute({ themeId: 'nope' }, ctx)) as Record<string, unknown>;
    expect(missing.error).toMatch(/list_themes/);
  });

  it('delete_theme removes customs and protects built-ins', async () => {
    const gen = (await findTool('settings.generate_theme').execute({ nameAr: 'Z', mode: 'light' }, ctx)) as Record<string, unknown>;
    const del = findTool('settings.delete_theme');
    const blocked = (await del.execute({ themeId: 'emerald-light' }, ctx)) as Record<string, unknown>;
    expect(blocked.error).toMatch(/محمية/);
    const ok = (await del.execute({ themeId: gen.id }, ctx)) as Record<string, unknown>;
    expect(ok.deleted).toBe(true);
    expect(useAppStore.getState().customThemes).toHaveLength(0);
  });

  it('theme tools carry the settings/themes route and write RBAC', () => {
    for (const name of ['settings.generate_theme', 'settings.create_theme', 'settings.update_theme', 'settings.activate_theme', 'settings.delete_theme']) {
      const tool = findTool(name);
      expect(tool.route).toBe('/settings/themes');
      expect(tool.permission).toBe('settings.edit');
      expect(tool.dangerLevel).toBe('write');
      expect(typeof tool.summarizeArgs).toBe('function');
    }
    expect(findTool('settings.list_themes').permission).toBe('settings.view');
    expect(findTool('settings.list_themes').dangerLevel).toBe('read');
  });
});
