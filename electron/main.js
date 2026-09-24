import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { registerAuthHandlers, registerDatabaseHandlers, registerOnboardingHandlers } from './dbHandler.js';
import { registerAiHandlers } from './aiHandler.js';
import { runDrizzleMigrations } from './migrationRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
config({ path: path.join(__dirname, '../.env.local') });

let mainWindow;

// Silent-download bookkeeping for app:downloadUpdate: electron-updater
// rejects overlapping downloadUpdate() calls, so the main process — not the
// renderer — owns the in-flight flag plus which version already landed.
const updateDl = { downloading: false, downloadedVersion: null };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    title: 'محاسبة المغز | MaghzAccount Pro — نظام ERP محاسبي متكامل',
    frame: true,
    show: false,
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // The application never opens untrusted content in its privileged renderer.
  // Block popups and navigation attempts so an external URL cannot inherit this
  // BrowserWindow's preload bridge.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const expected = isDev ? 'http://localhost:5173' : 'file:';
    if (!url.startsWith(expected)) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Diagnosability: a silent early exit is the worst failure mode for a
// desktop app ("the installer does nothing"). Persist main-process crashes
// to a log file inside userData so any future "does not start" report
// arrives with the real reason attached.
function appendMainLog(line) {
  try {
    let dir = null;
    try {
      dir = app.getPath('userData');
    } catch {
      dir = null;
    }
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'maghzaccount-main.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // logging must never crash the app
  }
}

process.on('uncaughtException', (err) => {
  const msg = `UNCAUGHT: ${(err && err.stack) || err}`;
  console.error('[App]', msg);
  appendMainLog(msg);
});

process.on('unhandledRejection', (reason) => {
  const msg = `UNHANDLED REJECTION: ${(reason && reason.stack) || reason}`;
  console.error('[App]', msg);
  appendMainLog(msg);
});

app.whenReady().then(async () => {
  // Register PostgreSQL IPC handlers (Drizzle ORM bridge)
  registerDatabaseHandlers();
  registerAuthHandlers();

  // Register onboarding IPC handlers (connection test, seed, config)
  registerOnboardingHandlers();

  // Register AI Harness IPC handlers (LLM proxy — key stays in main process)
  registerAiHandlers();

  // ─── App version + updater IPC (must be before window) ──────────────────
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:checkForUpdates', async () => {
    try {
      const { autoUpdater } = await import('electron-updater');
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('app:quitAndInstall', () => {
    import('electron-updater').then(({ autoUpdater }) => autoUpdater.quitAndInstall());
  });
  // Silent background download on demand: the banner's download button calls
  // this when no download is in flight yet (auto-download may have missed —
  // check raced, error, portable fallback). Guarded against double-starts;
  // progress/completion still flow through the update:* events below.
  ipcMain.handle('app:downloadUpdate', async () => {
    try {
      const { autoUpdater } = await import('electron-updater');
      if (updateDl.downloading) return { success: true, already: true };
      if (updateDl.downloadedVersion) return { success: true, already: true, downloaded: true };
      updateDl.downloading = true;
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } finally {
        updateDl.downloading = false;
      }
    } catch (err) {
      updateDl.downloading = false;
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  // Capability probe for the renderer: portable / store builds cannot be
  // updated by electron-updater (no installed updater) — the UI then falls
  // back to opening the releases page instead of a doomed silent download.
  ipcMain.handle('app:updateCaps', () => {
    const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
    const store = !!process.windowsStore;
    return { canAutoUpdate: !portable && !store };
  });
  // External links from the privileged renderer: window.open is denied by
  // setWindowOpenHandler, so releases/whats-new links go through the shell
  // with a strict allowlist (our own GitHub releases only).
  ipcMain.handle('app:openExternal', (_e, url) => {
    const target = String(url ?? '');
    if (/^https:\/\/github\.com\/AhmedAlmaghz\/MaghzAccountFlash4\//.test(target)) {
      void shell.openExternal(target);
      return { success: true };
    }
    return { success: false, error: 'URL not allowed' };
  });
  ipcMain.handle('app:setUpdateChannel', async (_e, channel) => {
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.allowPrerelease = channel === 'beta';
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Open the window FIRST. Migrations can take 15s+ on a machine without a
  // local PostgreSQL (connection timeout) — blocking the window behind them
  // looks exactly like "the installer produced an empty app that does nothing".
  // Migrations heal in the background; the renderer (PGlite-first) works meanwhile.
  createWindow();

  // Run Drizzle migrations on PostgreSQL (single source of truth for schema)
  runDrizzleMigrations()
    .then(() => console.log('[App] PostgreSQL (Drizzle) ready.'))
    .catch((err) => {
      console.error('[App] PostgreSQL migration failed:', err.message);
      appendMainLog(`migration failed: ${err.message}`);
      console.warn('[App] PostgreSQL unavailable — PGlite local database remains available.');
    });

  // Auto-updater: check in background (not in dev), download in background,
  // notify renderer via webContents.send — the UI shows the banner.
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (!isDev) {
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      // Default to stable; renderer can switch to beta via app:setUpdateChannel
      try {
        const raw = fs.readFileSync(path.join(app.getPath('userData'), 'update-channel.json'), 'utf8');
        const parsed = JSON.parse(raw);
        autoUpdater.allowPrerelease = parsed.channel === 'beta';
      } catch { /* default stable */ }
      autoUpdater.on('checking-for-update', () => {
        mainWindow?.webContents.send('update:checking');
      });
      autoUpdater.on('update-available', (info) => {
        updateDl.downloadedVersion = null;
        mainWindow?.webContents.send('update:available', info);
      });
      autoUpdater.on('update-not-available', (info) => {
        mainWindow?.webContents.send('update:not-available', info);
      });
      autoUpdater.on('download-progress', (p) => {
        mainWindow?.webContents.send('update:progress', p);
      });
      autoUpdater.on('update-downloaded', (info) => {
        updateDl.downloading = false;
        updateDl.downloadedVersion = info?.version ?? 'unknown';
        mainWindow?.webContents.send('update:downloaded', info);
      });
      autoUpdater.on('error', (err) => {
        updateDl.downloading = false;
        mainWindow?.webContents.send('update:error', err?.message || String(err));
      });
      // Persist channel choice from renderer
      ipcMain.on('app:updateChannelChanged', (_e, channel) => {
        autoUpdater.allowPrerelease = channel === 'beta';
        try {
          fs.writeFileSync(path.join(app.getPath('userData'), 'update-channel.json'), JSON.stringify({ channel }));
        } catch { /* ignore */ }
      });
      // First check after 8s, then every 6h
      setTimeout(() => { autoUpdater.checkForUpdates().catch(() => { /* silent */ }); }, 8000);
      setInterval(() => { autoUpdater.checkForUpdates().catch(() => { /* silent */ }); }, 6 * 60 * 60 * 1000);
    } catch (err) {
      console.warn('[App] autoUpdater unavailable:', err instanceof Error ? err.message : String(err));
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
