import { app, BrowserWindow } from 'electron';
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
    title: 'maghzaccount-pro - نظام ERP محاسبي متكامل',
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

app.whenReady().then(async () => {
  // Register PostgreSQL IPC handlers (Drizzle ORM bridge)
  registerDatabaseHandlers();
  registerAuthHandlers();

  // Register onboarding IPC handlers (connection test, seed, config)
  registerOnboardingHandlers();

  // Register AI Harness IPC handlers (LLM proxy — key stays in main process)
  registerAiHandlers();

  // Run Drizzle migrations on PostgreSQL (single source of truth for schema)
  try {
    await runDrizzleMigrations();
    console.log('[App] PostgreSQL (Drizzle) ready.');
  } catch (err) {
    console.error('[App] PostgreSQL migration failed:', err.message);
    console.warn('[App] PostgreSQL unavailable — Mock adapter will serve as demo fallback.');
  }

  createWindow();

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
