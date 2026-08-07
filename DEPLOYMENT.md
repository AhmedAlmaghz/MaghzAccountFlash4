# دليل النشر والتوزيع — maghzaccount-pro

> **الغرض:** يوثق هذا الملف خطوات بناء ونشر وتوزيع التطبيق على بيئات التطوير والإنتاج المختلفة، بما في ذلك تطبيق Electron لسطح المكتب، الإصدارات الويبية، ومتطلبات النظام وإعدادات CI/CD.

---

## 1. نظرة عامة على بيئات النشر

| البيئة | المنصة | قاعدة البيانات | الغرض | التكرار |
|--------|--------|---------------|-------|---------|
| **Development (Web)** | Localhost (Vite) | Dexie/Mock | تطوير الواجهة | يومي |
| **Development (Electron)** | Electron local | PostgreSQL (Mock fallback) | تطوير سطح المكتب | يومي |
| **Staging** | Server داخلي أو VPS | PostgreSQL staging | اختبار ما قبل الإنتاج | عند كل Release |
| **Production (Desktop)** | Electron distributables | PostgreSQL local (Mock fallback) | المستخدم النهائي | عند كل Release |
| **Production (Web)** | VPS / Cloud (مستقبلي) | PostgreSQL / Supabase | SaaS مستقبلي | عند كل Release |

---

## 2. متطلبات النظام (System Requirements)

### 2.1 لجهاز التطوير

| المتطلب | الإصدار | ملاحظات |
|---------|---------|---------|
| **Node.js** | >= 20 LTS | مطلوب لـ Vite, Electron, Drizzle |
| **npm** | >= 10 | يأتي مع Node.js |
| **PostgreSQL** | >= 15 | إذا كنت تطور مع Layer 1 |
| **Git** | >= 2.40 | إدارة الإصدارات |
| **Python** | >= 3.10 | مطلوب لـ Electron native builds |
| **Visual Studio Build Tools** | 2022 | على Windows لـ Electron |

### 2.2 لجهاز المستخدم النهائي (Electron)

| نظام التشغيل | الإصدار | المتطلبات |
|--------------|---------|-----------|
| **Windows** | 10/11 (64-bit) | 4 GB RAM, 500 MB مساحة حرة |
| **macOS** | 12+ (Monterey) | Intel أو Apple Silicon, 4 GB RAM |
| **Linux** | Ubuntu 22.04+ / Fedora 38+ | 4 GB RAM, libc6 |

### 2.3 لخادم PostgreSQL (Production)

- **RAM:** >= 2 GB (4 GB موصى به).
- **CPU:** >= 2 cores.
- **Storage:** SSD، 10 GB كحد أدنى.
- **Network:** localhost فقط أو VPN/SSL إذا بعيد.

---

## 3. البنية التحتية (Infrastructure)

### 3.1 المكونات الرئيسية

```
┌─────────────────────────────────────────────────────────────┐
│                    maghzaccount-pro                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   Electron App   │  │   Web App       │  (مستقبلي)       │
│  │   (Desktop)      │  │   (Browser)     │                  │
│  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                            │
│           ▼                    ▼                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Database Layer                         │    │
│  │  ┌──────────┐  ┌──────────┐                         │    │
│  │  │PostgreSQL│  │  Mock    │                         │    │
│  │  │(Primary) │  │ (Dev)    │                         │    │
│  │  └──────────┘  └──────────┘                         │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 التبعيات الإنتاجية

```json
{
  "dependencies": {
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "zustand": "^5.0.13",
    "lucide-react": "^1.16.0",
    "recharts": "^2.12.0",
    "@tremor/react": "^3.17.0",
    "@tanstack/react-table": "^8.17.0",
    "jspdf": "^2.5.2",
    "jspdf-autotable": "^3.8.4",
    "xlsx": "^0.18.5",
    "drizzle-orm": "^0.45.2",
    "pg": "^8.21.0",
    "dexie": "^4.4.2"
  }
}
```

---

## 4. بناء التطبيق (Build Process)

### 4.1 البناء للويب (`npm run build`)

```bash
# 1. تثبيت التبعيات
npm ci

# 2. فحص الأخطاء اللغوية
npm run lint

# 3. اختبار الوحدات (اختياري لكن مستحسن)
npm run test:unit

# 4. البناء
npm run build
```

**النتيجة:**
- مجلد `dist/` يحتوي على:
  - `index.html`
  - ملفات CSS/JS المُحسّنة
  - الأصول الثابتة (assets)
  - خطوط Cairo/Inter (مضمنة)

### 4.2 البناء لـ Electron (`npm run electron:build`)

```bash
# 1. تثبيت التبعيات
npm ci

# 2. بناء الواجهة أولاً
npm run build

# 3. بناء Electron distributables
npm run electron:build
```

**النتيجة:**
- مجلد `dist-electron/` يحتوي على:
  - `maghzaccount-pro Setup.exe` (Windows installer)
  - `maghzaccount-pro.dmg` (macOS disk image)
  - `maghzaccount-pro.AppImage` (Linux portable)
  - `win-unpacked/`, `mac/`, `linux-unpacked/` — إصدارات غير مضغوطة

---

## 5. إعدادات Electron Builder

### 5.1 التكوين الأساسي (`package.json`)

```json
{
  "name": "maghzaccount-pro",
  "version": "0.0.0",
  "main": "electron/main.js",
  "build": {
    "appId": "com.maghzaccount.pro",
    "productName": "maghzaccount-pro",
    "directories": {
      "output": "dist-electron"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "node_modules/**/*"
    ],
    "extraResources": [
      {
        "from": "migrations/",
        "to": "migrations/",
        "filter": ["**/*"]
      }
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "build/icon.ico"
    },
    "mac": {
      "target": [
        {
          "target": "dmg",
          "arch": ["x64", "arm64"]
        }
      ],
      "icon": "build/icon.icns",
      "category": "public.app-category.finance"
    },
    "linux": {
      "target": [
        {
          "target": "AppImage",
          "arch": ["x64"]
        }
      ],
      "icon": "build/icon.png",
      "category": "Office"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "maghzaccount-pro"
    },
    "publish": {
      "provider": "github",
      "owner": "maghzaccount",
      "repo": "maghzaccount-pro"
    }
  }
}
```

### 5.2 عملية Electron الرئيسية (`electron/main.js`)

```js
const { app, BrowserWindow, ipcMain, dialog, autoUpdater } = require('electron');
const path = require('path');

const isDev = process.argv.includes('--dev');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Auto-updater
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC handlers
ipcMain.handle('db:ping', async () => {
  // منطق الـ ping لـ PostgreSQL
  return { success: true, latency: 12 };
});

ipcMain.handle('app:version', () => app.getVersion());
```

### 5.3 Preload Script (`electron/preload.js`)

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Database
  pingDatabase: () => ipcRenderer.invoke('db:ping'),
  getCompany: () => ipcRenderer.invoke('db:getCompany'),
  saveCompany: (data) => ipcRenderer.invoke('db:saveCompany', data),

  // System
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),

  // Platform
  platform: process.platform,
});
```

---

## 6. إعداد PostgreSQL للإنتاج

### 6.1 إنشاء قاعدة البيانات

```bash
# تسجيل الدخول لـ postgres
sudo -u postgres psql

# إنشاء مستخدم وقاعدة بيانات
CREATE USER maghz_app WITH ENCRYPTED PASSWORD 'strong_password_here';
CREATE DATABASE maghzaccount_db OWNER maghz_app;
GRANT ALL PRIVILEGES ON DATABASE maghzaccount_db TO maghz_app;

# الخروج
\q
```

### 6.2 تهيئة Drizzle (`drizzle.config.ts`)

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/core/database/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'maghz_app',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'maghzaccount_db',
  },
});
```

### 6.3 تشغيل Migrations

```bash
# توليد migration جديد
npx drizzle-kit generate

# تطبيق migrations على قاعدة البيانات
npx drizzle-kit migrate

# التحقق من الحالة
npx drizzle-kit check
```

### 6.4 النسخ الاحتياطي والاستعادة

```bash
# نسخ احتياطي
pg_dump -U maghz_app -d maghzaccount_db -F c -f backup_$(date +%Y%m%d).dump

# استعادة
pg_restore -U maghz_app -d maghzaccount_db backup_20260524.dump
```

---

## 7. النشر على الويب (Web Deployment — مستقبلي)

### 7.1 البناء للإنتاج

```bash
# تعيين متغيرات البيئة
export VITE_API_URL=https://api.maghzaccount.com
export VITE_APP_ENV=production

# البناء
npm run build
```

### 7.2 نشر على Nginx

```nginx
# /etc/nginx/sites-available/maghzaccount
server {
    listen 443 ssl http2;
    server_name app.maghzaccount.com;

    root /var/www/maghzaccount/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # SSL
    ssl_certificate /etc/letsencrypt/live/app.maghzaccount.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.maghzaccount.com/privkey.pem;
}
```

### 7.3 Docker (مستقبلي)

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

---

## 8. CI/CD Pipeline

### 8.1 GitHub Actions — Build & Test

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit -- --coverage
      - run: npm run test:integration

  build-web:
    needs: lint-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: web-build
          path: dist/
```

### 8.2 GitHub Actions — Electron Build & Release

```yaml
# .github/workflows/release.yml
name: Build & Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-electron:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run electron:build
      - uses: actions/upload-artifact@v4
        with:
          name: electron-${{ matrix.os }}
          path: |
            dist-electron/*.exe
            dist-electron/*.dmg
            dist-electron/*.AppImage

  release:
    needs: build-electron
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v1
        with:
          files: |
            electron-ubuntu-latest/**/*.AppImage
            electron-windows-latest/**/*.exe
            electron-macos-latest/**/*.dmg
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 9. التحديث التلقائي (Auto-updater)

### 9.1 إعداد Auto-updater في Electron

```js
// electron/main.js
const { autoUpdater, dialog } = require('electron');

if (!isDev) {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'تحديث متاح',
      message: 'هناك نسخة جديدة من maghzaccount-pro. سيتم التنزيل في الخلفية.',
      buttons: ['حسناً'],
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'جاهز للتثبيت',
      message: 'تم تنزيل التحديث. أعد تشغيل التطبيق للتثبيت.',
      buttons: ['إعادة التشغيل الآن', 'لاحقاً'],
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
}
```

---

## 10. التحقق بعد النشر (Post-Deployment Checklist)

### 10.1 فحص Electron
- [ ] التطبيق يفتح بدون أخطاء.
- [ ] الاتصال بـ PostgreSQL يعمل (إذا كان متاحاً).
- [ ] Mock adapter يعمل كـ fallback.
- [ ] الترجمة تبدل بين العربية والإنجليزية.
- [ ] Dark Mode يعمل بشكل صحيح.
- [ ] الشعار والأيقونات تظهر.
- [ ] الاختصارات على سطح المكتب تعمل.
- [ ] Uninstaller يعمل بدون بقايا.
- [ ] Auto-updater يتحقق من التحديثات.

### 10.2 فحص الويب (مستقبلي)
- [ ] HTTPS يعمل مع شهادة صالحة.
- [ ] API يستجيب بشكل صحيح.
- [ ] PWA manifest صحيح.
- [ ] التخزين المحلي يعمل.

---

## 11. استكشاف الأخطاء الشائعة (Troubleshooting)

| المشكلة | السبب المحتمل | الحل |
|---------|--------------|------|
| `electron:build` يفشل على Windows | Visual Studio Build Tools غير مثبت | ثبت VS Build Tools 2022 |
| PostgreSQL لا يستجيب | الخدمة متوقفة أو بيانات الاعتماد خاطئة | تحقق من `pg_isready` و `.env` |
| Blank screen في Electron | مسار index.html خاطئ | تحقق من `loadFile()` path |
| Icons لا تظهر | أيقونات غير موجودة في `build/` | ضع `icon.ico`, `icon.icns`, `icon.png` في `build/` |
| `npm ci` يفشل | `package-lock.json` غير متزامن | شغّل `npm install` ثم ارفع `package-lock.json` |
| Tailwind classes لا تعمل | المسارات غير مضافة في `tailwind.config.js` | أضف `./src/**/*.{js,ts,jsx,tsx}` |
| PDF لا يدعم العربية | خط Cairo غير محمل | استخدم `doc.addFileToVFS` لتحميل خط Cairo في `jspdf` |

---

## 12. دليل التراجع (Rollback)

### 12.1 إذا فشل إصدار جديد

```bash
# 1. استعادة قاعدة البيانات من النسخة الاحتياطية
pg_restore -U maghz_app -d maghzaccount_db backup_previous.dump

# 2. استعادة الكود
git checkout v[الإصدار_السابق]

# 3. إعادة البناء
npm ci
npm run electron:build

# 4. توزيع الإصدار السابق على المستخدمين
```

### 12.2 إذا فشلت Migration

```bash
# التحقق من حالة migrations
npx drizzle-kit check

# إذا كانت migration عالقة
npx drizzle-kit drop  # احذر: هذا يحذف migration
```

---

## 13. الأمان (Security)

### 13.1 قاعدة البيانات
- استخدم SSL للاتصالات البعيدة.
- لا تُخزن كلمات المرور في الكود.
- استخدم متغيرات البيئة (`.env`).

### 13.2 Electron
- استخدم `contextIsolation: true`.
- لا تُعرض Node.js APIs مباشرة للـ Renderer.
- فعّل `nodeIntegration: false`.

---

## 14. أوامر التشغيل والبناء

```bash
# التطوير (ويب)
npm run dev

# التطوير (Electron)
npm run electron:dev

# البناء (ويب)
npm run build

# البناء (Electron)
npm run electron:build

# الفحص اللغوي
npm run lint

# الاختبارات
npm run test

# توليد Migration
npx drizzle-kit generate

# تطبيق Migration
npx drizzle-kit migrate
```

---

*آخر تحديث: 2026-05-24 | مسؤول DevOps: Lead Infrastructure*
