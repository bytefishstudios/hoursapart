import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4321';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ? resolve(process.env.SCREENSHOT_DIR) : null;
const CDP_PORT = Number(process.env.CDP_PORT ?? 9300 + (process.pid % 500));

const pages = [
  {
    name: 'home',
    path: '/?p=Australia%2FSydney-540-1020-12345%7CEurope%2FLondon-540-1020-12345%7CAsia%2FTokyo-540-1020-12345&a=0&m=60&d=2026-01-15',
    component: '/src/components/WorldClock.tsx',
    text: 'Copy this clock as a link',
    selectors: [
      'input[aria-label="Base city name"]',
      'button[aria-label^="Remove base city"]',
      'button[data-reorder-handle]',
      '[data-day-shift]',
      '[data-local-date]',
      'button[title^="Use this city"]',
    ],
  },
  {
    name: 'overlap',
    path: '/overlap?p=Europe%2FLondon-1080-120-12345&m=30&d=2026-01-13',
    component: '/src/components/TeamPlanner.tsx',
    text: 'Download .ics',
    selectors: [
      'select[aria-label="Meeting start"]',
      'select[aria-label="Meeting end"]',
      'select[aria-label^="Choose a"]',
      '[data-working-hours-row]',
      'a[href*="calendar.google.com"]',
    ],
  },
  {
    name: 'city',
    path: '/time/chengdu',
    component: '/src/components/CityClock.tsx',
    text: 'Current time in Chengdu',
  },
  {
    name: 'difference',
    path: '/difference/london/sydney',
    component: '/src/components/PairClock.tsx',
    text: 'Sydney is',
  },
  {
    name: 'contact',
    path: '/contact',
    component: null,
    text: 'Open the feedback form',
    selectors: ['a[href="https://tally.so/r/jaRql6"][target="_blank"]'],
  },
];

const viewports = [
  { name: 'desktop', width: 1440, height: 1000, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function waitFor(check, message, timeout = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await check()) return;
    } catch {
      // The process or endpoint may still be starting.
    }
    await sleep(250);
  }
  throw new Error(message);
}

async function urlIsReady(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable.');
  }
  return found;
}

class CdpSession {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolveMessage, rejectMessage } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) rejectMessage(new Error(message.error.message));
        else resolveMessage(message.result ?? {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params.exceptionDetails);
      }
    };

    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.onopen = resolveOpen;
      this.socket.onerror = rejectOpen;
    });
    await this.call('Page.enable');
    await this.call('Runtime.enable');
    await this.call('Log.enable');
  }

  call(method, params = {}) {
    return new Promise((resolveMessage, rejectMessage) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolveMessage, rejectMessage });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? `Evaluation failed: ${expression}`);
    }
    return result.result?.value;
  }

  resetExceptions() {
    this.exceptions = [];
  }

  close() {
    this.socket?.close();
  }
}

let devServer;
let chrome;
let chromeProfile;
let session;

async function cleanup() {
  session?.close();
  if (chrome && !chrome.killed) {
    chrome.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => chrome.once('exit', resolveExit)),
      sleep(2_000),
    ]);
  }
  if (devServer && !devServer.killed) devServer.kill('SIGTERM');
  if (chromeProfile) {
    try {
      await rm(chromeProfile, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Chrome can briefly recreate session files while shutting down; the OS
      // will eventually clear this temporary profile even if that race wins.
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(1);
  });
}

try {
  if (!(await urlIsReady(BASE_URL))) {
    devServer = spawn('npm', ['run', 'dev', '--', '--force'], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitFor(() => urlIsReady(BASE_URL), `Astro did not become ready at ${BASE_URL}`);
  }

  chromeProfile = await mkdtemp(join(tmpdir(), 'hoursapart-smoke-'));
  chrome = spawn(
    chromePath(),
    [
      '--headless=new',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--no-first-run',
      '--no-sandbox',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${chromeProfile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  await waitFor(
    () => urlIsReady(`${endpoint}/json/version`),
    'Chrome DevTools did not start',
    30_000,
  );

  const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
  const target = targets.find((candidate) => candidate.type === 'page');
  if (!target) throw new Error('Chrome did not expose a page target');

  session = new CdpSession(target.webSocketDebuggerUrl);
  await session.connect();
  if (SCREENSHOT_DIR) await mkdir(SCREENSHOT_DIR, { recursive: true });

  const report = [];
  for (const viewport of viewports) {
    await session.call('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });

    for (const page of pages) {
      session.resetExceptions();
      await session.call('Page.navigate', { url: new URL(page.path, BASE_URL).href });
      await waitFor(
        async () => {
          const state = await session.evaluate(`(() => {
            const island = document.querySelector('astro-island');
            return {
              ready: document.readyState === 'complete',
              component: island?.getAttribute('component-url') ?? '',
              rendered: Number(island?.getAttribute('client-render-time') ?? 0) > 0,
            };
          })()`);
          return (
            state.ready &&
            (page.component === null || (state.component === page.component && state.rendered))
          );
        },
        `${page.name} did not become ready${page.component ? ` and hydrate ${page.component}` : ''}`,
        30_000,
      );
      await sleep(750);

      let interactionPassed = true;
      let interactionDetails = null;
      if (page.name === 'home') {
        await session.evaluate(
          `document.querySelector('button[data-reorder-handle]')?.closest('ul')?.scrollIntoView({ block: 'center' })`,
        );
        await sleep(100);
        const dragPlan = await session.evaluate(`(() => {
          const labels = [...document.querySelectorAll('input[aria-label^="Name for "]')].map((input) => input.value);
          const base = document.querySelector('input[aria-label="Base city name"]');
          const handle = document.querySelector('button[data-reorder-handle]:not(:disabled)');
          const rows = [...document.querySelectorAll('[data-reorder-row]')];
          if (!(base instanceof HTMLInputElement) || !(handle instanceof HTMLButtonElement) || rows.length < 2) return null;
          const source = handle.getBoundingClientRect();
          const target = rows[rows.length - 1].getBoundingClientRect();
          return {
            base: base.value,
            moved: labels[0],
            target: rows.length - 1,
            startX: source.left + source.width / 2,
            startY: source.top + source.height / 2,
            endY: target.bottom - 4,
          };
        })()`);
        if (dragPlan === null) {
          interactionPassed = false;
          interactionDetails = { reason: 'No draggable rows found' };
        } else {
          await session.call('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: dragPlan.startX,
            y: dragPlan.startY,
            button: 'left',
            buttons: 1,
            clickCount: 1,
          });
          const afterPress = await session.evaluate(`(() => ({
            dragging: document.querySelector('.is-dragging input[aria-label^="Name for "]')?.value ?? '',
            labels: [...document.querySelectorAll('input[aria-label^="Name for "]')].map((input) => input.value),
          }))()`);
          await session.call('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: dragPlan.startX,
            y: dragPlan.startY + 12,
            button: 'none',
            buttons: 1,
          });
          await sleep(50);
          await session.call('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: dragPlan.startX,
            y: dragPlan.endY,
            button: 'none',
            buttons: 1,
          });
          await sleep(100);
          const afterMove = await session.evaluate(`(() => {
            const dragged = document.querySelector('.is-dragging');
            return {
              dragging: dragged?.querySelector('input[aria-label^="Name for "]')?.value ?? '',
              transform: dragged ? getComputedStyle(dragged).transform : 'none',
              labels: [...document.querySelectorAll('input[aria-label^="Name for "]')].map((input) => input.value),
            };
          })()`);
          await session.call('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: dragPlan.startX,
            y: dragPlan.endY,
            button: 'left',
            buttons: 0,
            clickCount: 1,
          });
          await sleep(150);
          const afterOrder = await session.evaluate(`(() => ({
            base: document.querySelector('input[aria-label="Base city name"]')?.value ?? '',
            labels: [...document.querySelectorAll('input[aria-label^="Name for "]')].map((input) => input.value),
          }))()`);
          interactionPassed =
            afterMove.dragging === dragPlan.moved &&
            afterMove.transform !== 'none' &&
            afterMove.transform !== 'matrix(1, 0, 0, 1, 0, 0)' &&
            afterOrder.base === dragPlan.base &&
            afterOrder.labels[dragPlan.target] === dragPlan.moved;
          interactionDetails = { dragPlan, afterPress, afterMove, afterOrder };
        }
      }

      if (page.name === 'overlap') {
        const beforeDuration = await session.evaluate(`(() => {
          const rows = [...document.querySelectorAll('[data-working-hours-row]')];
          const signature = rows.map((row) =>
            [...row.querySelectorAll('[data-working-hours]')]
              .map((slot) => slot.getAttribute('data-working-hours'))
              .join(','),
          );
          const duration = document.querySelector('select[aria-label="Meeting end"]');
          if (!(duration instanceof HTMLSelectElement)) return null;
          duration.value = '120';
          duration.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            signature,
            rowCount: rows.length,
            oldFreeCopyPresent:
              document.body.innerText.includes('everyone free') ||
              document.body.innerText.includes('some people free'),
          };
        })()`);
        await sleep(150);
        const afterDuration = await session.evaluate(`(() => ({
          signature: [...document.querySelectorAll('[data-working-hours-row]')].map((row) =>
            [...row.querySelectorAll('[data-working-hours]')]
              .map((slot) => slot.getAttribute('data-working-hours'))
              .join(','),
          ),
          duration: new URL(location.href).searchParams.get('l'),
          hasWorkingHoursLegend: document.body.innerText.includes('working hours'),
          partialCoverageVisible: document.body.innerText.includes(
            '1h 30m of 2 hours within hours',
          ),
        }))()`);
        const durationPassed =
          beforeDuration !== null &&
          beforeDuration.rowCount > 0 &&
          !beforeDuration.oldFreeCopyPresent &&
          JSON.stringify(beforeDuration.signature) === JSON.stringify(afterDuration.signature) &&
          afterDuration.duration === '120' &&
          afterDuration.hasWorkingHoursLegend &&
          afterDuration.partialCoverageVisible;
        const quarterHour = await session.evaluate(`(() => {
          const start = document.querySelector('select[aria-label="Meeting start"]');
          if (!(start instanceof HTMLSelectElement)) return null;
          const has1115 = [...start.options].some((option) => option.value === '675');
          start.value = '675';
          start.dispatchEvent(new Event('change', { bubbles: true }));
          return { has1115, options: start.options.length };
        })()`);
        await sleep(150);
        const quarterHourPassed =
          quarterHour !== null &&
          quarterHour.has1115 &&
          quarterHour.options === 96 &&
          (await session.evaluate(`new URL(location.href).searchParams.get('m') === '675'`));
        interactionPassed = durationPassed && quarterHourPassed;
        interactionDetails = { beforeDuration, afterDuration, quarterHour, quarterHourPassed };

        if (viewport.mobile) {
          const picked = await session.evaluate(`(() => {
            const select = document.querySelector('select[aria-label^="Choose a"]');
            if (!(select instanceof HTMLSelectElement) || select.options.length < 2) return null;
            select.value = select.options[1].value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return select.value;
          })()`);
          await sleep(150);
          const startPersisted =
            picked !== null &&
            (await session.evaluate(
              `new URL(location.href).searchParams.get('m') === ${JSON.stringify(picked)}`,
            ));
          interactionPassed = interactionPassed && startPersisted;
          interactionDetails = { ...interactionDetails, picked, startPersisted };
        }
      }

      const metrics = await session.evaluate(`(() => {
        const island = document.querySelector('astro-island');
        const root = document.documentElement;
        const scenario = new URLSearchParams(location.search).get('p');
        const scenarioPeople = scenario ? (scenario.includes('|') ? scenario.split('|').length : 1) : 0;
        const visibleClockRows = document.querySelectorAll('input[aria-label^="Name for "]').length;
        const reorderHandles = [...document.querySelectorAll('button[data-reorder-handle]')];
        const dayBlocks = [...document.querySelectorAll('[data-day-shift]')];
        const londonInput = [...document.querySelectorAll('input[aria-label^="Name for "]')].find(
          (input) => input.value === 'London',
        );
        const londonRow = londonInput?.closest('li');
        const londonDate = londonRow?.querySelector('[data-local-date]')?.textContent?.trim() ?? '';
        const londonDayShift =
          londonRow?.querySelector('[data-day-shift]')?.getAttribute('data-day-shift') ?? '';
        const londonDayText =
          londonRow?.querySelector('[data-day-shift]')?.textContent?.trim() ?? '';
        const knownDateCorrect =
          londonDate === 'Wednesday, January 14, 2026' &&
          londonDayShift === '-1' &&
          londonDayText.includes('Yesterday');
        const obsoleteOrderControls = document.querySelectorAll(
          'button[aria-label^="Move "], select[data-position-select]',
        ).length;
        const worldClockHierarchyClear =
          ${JSON.stringify(page.name)} !== 'home' ||
          (scenarioPeople > 0 &&
            visibleClockRows === scenarioPeople - 1 &&
            reorderHandles.length === visibleClockRows &&
            dayBlocks.length === visibleClockRows &&
            obsoleteOrderControls === 0 &&
            knownDateCorrect &&
            reorderHandles.every((handle) =>
              handle.getAttribute('aria-label')?.startsWith('Drag to reorder '),
            ) &&
            dayBlocks.every((day) => Number.isInteger(Number(day.dataset.dayShift))));
        return {
          url: location.href,
          title: document.title,
          component: island?.getAttribute('component-url') ?? '',
          islandHtmlLength: island?.innerHTML.length ?? 0,
          clientRenderTime: Number(island?.getAttribute('client-render-time') ?? 0),
          hasExpectedText: document.body.innerText.toLowerCase().includes(${JSON.stringify(page.text.toLowerCase())}),
          worldClockHierarchyClear,
          worldClockDetails:
            ${JSON.stringify(page.name)} === 'home'
              ? {
                  scenarioPeople,
                  visibleClockRows,
                  reorderHandles: reorderHandles.length,
                  dayBlocks: dayBlocks.length,
                  obsoleteOrderControls,
                  londonDate,
                  londonDayShift,
                  londonDayText,
                  knownDateCorrect,
                }
              : null,
          missingSelectors: ${JSON.stringify(page.selectors ?? [])}.filter((selector) => !document.querySelector(selector)),
          textPreview: island?.innerText.slice(0, 240) ?? document.body.innerText.slice(0, 240),
          horizontalOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
        };
      })()`);

      const exceptions = session.exceptions.map((exception) => ({
        text: exception.text,
        description: exception.exception?.description ?? exception.exception?.value ?? '',
        url: exception.url,
        lineNumber: exception.lineNumber,
        columnNumber: exception.columnNumber,
      }));

      let screenshot;
      if (SCREENSHOT_DIR) {
        const capture = await session.call('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
        });
        screenshot = join(SCREENSHOT_DIR, `${page.name}-${viewport.name}.png`);
        await writeFile(screenshot, Buffer.from(capture.data, 'base64'));
      }

      report.push({
        page: page.name,
        viewport: viewport.name,
        requiresHydration: page.component !== null,
        interactionPassed,
        interactionDetails,
        ...metrics,
        exceptions,
        screenshot: screenshot ? basename(screenshot) : undefined,
      });
    }
  }

  const failures = report.filter(
    (entry) =>
      (entry.requiresHydration &&
        (entry.component.length === 0 ||
          entry.islandHtmlLength === 0 ||
          entry.clientRenderTime <= 0)) ||
      !entry.hasExpectedText ||
      !entry.worldClockHierarchyClear ||
      !entry.interactionPassed ||
      entry.missingSelectors.length > 0 ||
      entry.exceptions.length > 0 ||
      entry.horizontalOverflow > 0,
  );

  console.log(JSON.stringify({ baseUrl: BASE_URL, failures, pages: report }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
