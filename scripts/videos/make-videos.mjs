// Auto-produce narrated module tour videos (screen + Arabic TTS voice).
// Usage: node scripts/videos/make-videos.mjs [moduleId ...]
// Requirements: dev server with e2e DB bridge (DOCS_BASE_URL, default
// http://localhost:5273) + ffmpeg on PATH + edge-tts (pip install edge-tts).
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MODULES, VOICE, PAD } from './scenes.mjs';

const BASE_URL = process.env.VIDEOS_BASE_URL || 'http://localhost:5273';
const OUT_DIR = path.resolve('Docs2/videos/ar');
const WORK = path.join(os.tmpdir(), 'maghz-videos-work');
const PROFILE = path.join(os.tmpdir(), 'maghz-videos-ar-profile');
const VIEWPORT = { width: 1440, height: 900 };
const INIT_SCRIPT = () => {
  const app = JSON.parse(localStorage.getItem('maghzaccount-app') || '{"state":{},"version":0}');
  app.state.language = 'ar';
  app.state.theme = 'light';
  localStorage.setItem('maghzaccount-app', JSON.stringify(app));
  localStorage.setItem('maghzaccount-db-mode', 'pg');
  localStorage.setItem('maghzaccount-onboarding', JSON.stringify({
    state: { completed: true, currentStep: 4, companyConfig: {}, seedOption: 'demo', isProcessing: false, processingMessage: '', error: null },
    version: 0,
  }));
};

const ffmpeg = (args, label) => {
  execSync(`ffmpeg -y -hide_banner -loglevel error ${args}`, { stdio: 'pipe' });
  console.log('   ffmpeg:', label);
};
const ffprobeDur = (file) =>
  parseFloat(execSync(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${file}"`,
  ).toString().trim());

async function tts(text, out) {
  await new Promise((res, rej) => {
    const p = spawn('python', ['-m', 'edge_tts', '--voice', VOICE, '--text', text, '--write-media', out]);
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`edge-tts exit ${c}`))));
    p.on('error', rej);
  });
}

async function loginIfNeeded(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  const t = await page.evaluate(() => document.body.innerText);
  if (!t.includes('لوحة التحكم') && !t.includes('Dashboard')) {
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.getByRole('textbox', { name: /اسم المستخدم|Username/ }).fill('admin');
    await page.getByRole('textbox', { name: /كلمة المرور|Password/ }).fill('admin1234');
    await page.getByRole('button', { name: /تسجيل الدخول|Login/ }).click();
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 60000 });
    console.log('   logged in');
  }
}

async function recordModule(mod) {
  const workDir = path.join(WORK, mod.id);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  // 1) narration audio per scene
  const audioFiles = [];
  for (let i = 0; i < mod.scenes.length; i++) {
    const f = path.join(workDir, `scene-${i}.mp3`);
    await tts(mod.scenes[i].text, f);
    audioFiles.push({ file: f, dur: ffprobeDur(f) });
    console.log(`   tts scene ${i + 1}/${mod.scenes.length}: ${audioFiles[i].dur.toFixed(1)}s`);
  }

  // 2) screen recording, paced to narration
  const videoDir = path.join(workDir, 'video');
  await mkdir(videoDir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'ar',
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  await page.setViewportSize(VIEWPORT);
  await loginIfNeeded(page);

  for (let i = 0; i < mod.scenes.length; i++) {
    const scene = mod.scenes[i];
    await page.goto(BASE_URL + scene.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // wait until the page is actually ready, then hold for the narration
    const start = Date.now();
    while (Date.now() - start < 25000) {
      const body = await page.evaluate(() => document.body.innerText).catch(() => '');
      const busy = await page.evaluate(() =>
        document.querySelectorAll('.animate-spin').length + document.querySelectorAll('[class*="animate-pulse"]').length);
      if (body.includes(scene.ready) && busy === 0) break;
      await page.waitForTimeout(700);
    }
    const holdMs = Math.max((audioFiles[i].dur + PAD) * 1000, 4500);
    await page.waitForTimeout(holdMs);
  }
  // closing context finalizes the webm — read the file only after close
  await ctx.close();
  const webm = path.join(videoDir, (await import('node:fs')).readdirSync(videoDir)[0]);
  console.log('   recorded:', path.basename(webm));

  // 3) concat narration with pads into one track
  const parts = [];
  const inputs = [];
  for (let i = 0; i < audioFiles.length; i++) {
    inputs.push('-i', audioFiles[i].file);
    parts.push(`[${i}:a]apad=pad_dur=${PAD}[a${i}]`);
  }
  const chain = `${parts.join(';')};${audioFiles.map((_, i) => `[a${i}]`).join('')}concat=n=${audioFiles.length}:v=0:a=1[out]`;
  const audioTrack = path.join(workDir, 'narration.wav');
  ffmpeg(`-y ${inputs.join(' ')} -filter_complex "${chain}" -map "[out]" -ar 44100 "${audioTrack}"`, 'narration track');
  const audioDur = ffprobeDur(audioTrack);

  // 4) mux video + narration → mp4
  const outFile = path.join(OUT_DIR, `${mod.id}.mp4`);
  ffmpeg(
    `-i "${webm}" -i "${audioTrack}" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 30 ` +
    `-af "apad=whole_dur=${audioDur}" -c:a aac -b:a 128k -shortest "${outFile}"`,
    'mux mp4',
  );
  console.log(`✓ ${mod.id}.mp4 (${ffprobeDur(outFile).toFixed(1)}s, ${(existsSync(outFile) ? 0 : 0)} bytes ok)`);
}

async function main() {
  const requested = process.argv.slice(2);
  const mods = requested.length ? MODULES.filter((m) => requested.includes(m.id)) : MODULES;
  await mkdir(OUT_DIR, { recursive: true });
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });

  // warm-up login in a throwaway context so the recorded context is already logged in
  {
    const ctx = await chromium.launchPersistentContext(PROFILE, { viewport: VIEWPORT, locale: 'ar' });
    await ctx.addInitScript(INIT_SCRIPT);
    const page = await ctx.newPage();
    await loginIfNeeded(page);
    await ctx.close();
    console.log('✓ warm-up login done');
  }

  for (const mod of mods) {
    console.log(`▶ ${mod.id} — ${mod.title}`);
    await recordModule(mod);
  }
  console.log('ALL DONE:', mods.length, 'videos →', OUT_DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
