/**
 * Capture product screenshots for the README.
 *
 * Runs against the app already running on localhost:3000 and reuses the
 * session token from a signed-in browser, passed in via OMNIA_TOKEN. No
 * credentials are handled by this script.
 *
 * Usage:
 *   OMNIA_TOKEN=<session token> node scripts/capture-screenshots.mjs
 */
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.OMNIA_URL || 'http://localhost:3000';
const TOKEN = process.env.OMNIA_TOKEN;
const OUT = 'assets/screenshots';

// Wide enough that the three-column dashboard renders as designed, and at 2x
// so the images stay sharp on the high-DPI displays most people read a
// README on.
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const SHOTS = [
  { file: '01-dashboard.png',        path: '/dashboard',
    label: 'Trial dashboard' },
  { file: '02-trial-detail.png',     path: null, // resolved from the trial list
    label: 'Trial detail with AI grading',
    expand: ['Investigational product', 'Cohort analytics'] },
  { file: '03-patient-registry.png', path: '/dashboard/patients',
    label: 'Patient registry' },
  { file: '04-patient-container.png', path: null, // resolved from the registry
    label: 'Patient record' },
  { file: '05-model-training.png',   path: '/dashboard/training',
    label: 'On-site model fine-tuning' },
  { file: '06-audit-trail.png',      path: '/dashboard/audit',
    label: 'Audit trail' },
];

if (!TOKEN) {
  console.error('OMNIA_TOKEN is required (read it from a signed-in session).');
  process.exit(1);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--force-device-scale-factor=2'],
});

try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // Seed the session before any app code runs, so the first paint is already
  // authenticated and no login screen is ever captured.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('omnia_auth_token', t);
    localStorage.setItem('omnia_setup_complete', 'true');
    // Suppress the first-run tour, which would cover every screenshot.
    localStorage.setItem('omnia_onboarding_seen', 'true');
  }, TOKEN);

  // Resolve the ids the app actually has rather than hardcoding them.
  const ids = await page.evaluate(async (t) => {
    const H = { Authorization: 'Bearer ' + t };
    const trials = await (await fetch('http://localhost:8000/api/trials/', { headers: H })).json();
    const patients = await (await fetch('http://localhost:8000/api/patients/', { headers: H })).json();
    return { trial: trials?.[0]?.id ?? null, patient: patients?.[0]?.uid ?? null };
  }, TOKEN);

  for (const shot of SHOTS) {
    let path = shot.path;
    if (shot.file.startsWith('02') && ids.trial) path = `/dashboard/trials/${ids.trial}`;
    if (shot.file.startsWith('04') && ids.patient) path = `/dashboard/patients/${ids.patient}`;
    if (!path) { console.log(`  skip ${shot.file} (nothing to show)`); continue; }

    await page.goto(BASE + path, { waitUntil: 'networkidle2' });
    // Let data load and any entrance transition settle before capturing.
    await new Promise((r) => setTimeout(r, 2500));

    // Open the collapsed detail panels. A screenshot of a closed accordion
    // row shows the feature exists but not what it does.
    if (shot.expand) {
      for (const label of shot.expand) {
        await page.evaluate((text) => {
          const hit = [...document.querySelectorAll('button, [role="button"]')]
            .find(b => b.textContent?.includes(text));
          hit?.click();
        }, label);
        await new Promise((r) => setTimeout(r, 900));
      }
      await new Promise((r) => setTimeout(r, 1200));
    }

    // Fit the frame to the content. A fixed 900px viewport left a third of
    // every image as empty background on the shorter pages, which reads as
    // an unfinished screen rather than a clean one.
    //
    // scrollHeight is useless here: the page shells use `min-h-screen`, so it
    // always equals the viewport and the frame never shrank. Measure the
    // lowest bottom edge of the actual rendered content instead, ignoring the
    // fixed-position help button that otherwise pins every page to full height.
    const contentHeight = await page.evaluate(() => {
      const vh = window.innerHeight;
      let bottom = 0;
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Skip page-shell containers: a `min-h-screen` wrapper is always at
        // least viewport-tall, so counting it pins every measurement to the
        // full viewport and the frame never shrinks.
        if (r.height >= vh * 0.9) continue;
        // Only elements that actually render something.
        if (!el.textContent?.trim() && el.tagName !== 'IMG' && el.tagName !== 'SVG') continue;
        bottom = Math.max(bottom, r.bottom + window.scrollY);
      }
      return Math.ceil(bottom);
    });
    const height = Math.min(Math.max(contentHeight + 24, 560), 2200);
    await page.setViewport({ ...VIEWPORT, height });
    await new Promise((r) => setTimeout(r, 400));

    await page.screenshot({ path: `${OUT}/${shot.file}` });
    await page.setViewport(VIEWPORT);
    console.log(`  ✓ ${shot.file}  — ${shot.label}`);
  }
} finally {
  await browser.close();
}
