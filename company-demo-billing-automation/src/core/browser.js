const { chromium } = require('playwright');
const path = require('path');
const dotenvPath = process.env.DOTENV_PATH || path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: dotenvPath });
const { isPatientUiAnonymizeEnabled } = require('./patientUiAnonymizer');

let browser = null;
let context = null;
let page = null;

const BASE_CHROMIUM_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials'
];

function parseBoolEnv(v, defaultValue = true) {
    if (v == null || String(v).trim() === '') return defaultValue;
    return !/^(0|false|no|off)$/i.test(String(v).trim());
}

/**
 * How many columns × rows to fill with N headed browser windows (landscape-friendly).
 * 4 → 2×2, 8 → 4×2, etc.
 */
function getTileGridDimensions(slotCount) {
    const n = Math.max(1, slotCount);
    if (n <= 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 };
    if (n <= 4) return { cols: 2, rows: 2 };
    if (n <= 6) return { cols: 3, rows: 2 };
    if (n <= 8) return { cols: 4, rows: 2 };
    if (n <= 9) return { cols: 3, rows: 3 };
    if (n <= 12) return { cols: 4, rows: 3 };
    if (n <= 16) return { cols: 4, rows: 4 };
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
}

/**
 * Pixel geometry for one headed tile (--window-size matches cellW×cellH).
 */
function computeTileMetrics(slotIndex, totalSlots) {
    const headless = process.env.HEADLESS === 'true';
    if (headless || totalSlots <= 1 || !parseBoolEnv(process.env.TILE_WINDOWS, true)) return null;

    const screenW = Math.max(400, parseInt(process.env.TILE_SCREEN_WIDTH || '1920', 10) || 1920);
    const screenH = Math.max(300, parseInt(process.env.TILE_SCREEN_HEIGHT || '1080', 10) || 1080);
    const gutter = Math.max(0, parseInt(process.env.TILE_GUTTER || '6', 10) || 0);
    const originX = parseInt(process.env.TILE_ORIGIN_X || '0', 10) || 0;
    const originY = parseInt(process.env.TILE_ORIGIN_Y || '0', 10) || 0;

    const { cols, rows } = getTileGridDimensions(totalSlots);
    const col = slotIndex % cols;
    const row = Math.floor(slotIndex / cols);

    const innerW = screenW - gutter * (cols + 1);
    const innerH = screenH - gutter * (rows + 1);
    const cellW = Math.max(320, Math.floor(innerW / cols));
    const cellH = Math.max(240, Math.floor(innerH / rows));
    const x = originX + gutter + col * (cellW + gutter);
    const y = originY + gutter + row * (cellH + gutter);
    return { cellW, cellH, x, y, cols, rows };
}

/**
 * Chromium flags to place each window in a grid so parallel headed slots stay visible.
 */
function tileWindowLaunchArgs(slotIndex, totalSlots) {
    const m = computeTileMetrics(slotIndex, totalSlots);
    if (!m) return [];
    console.log(`[Browser] Tile slot ${slotIndex}/${totalSlots} → ${m.cellW}×${m.cellH} @ (${m.x},${m.y}) [grid ${m.cols}×${m.rows}]`);
    return [`--window-size=${m.cellW},${m.cellH}`, `--window-position=${m.x},${m.y}`];
}

/** Shared launch options for Chromium (singleton and multi-instance). */
const launchOptions = (extraArgs = []) => ({
    headless: process.env.HEADLESS === 'true',
    args: [...BASE_CHROMIUM_ARGS, ...extraArgs]
});

const defaultViewport = { width: 1280, height: 800 };

/**
 * Target “desktop” layout size for headed tiled mode (CDP emulation). TILE_LAYOUT_* override defaults.
 */
function getTiledLayoutViewportSize() {
    const defW = Math.max(400, parseInt(process.env.TILE_SCREEN_WIDTH || '1920', 10) || 1920);
    const defH = Math.max(300, parseInt(process.env.TILE_SCREEN_HEIGHT || '1080', 10) || 1080);
    const w = parseInt(process.env.TILE_LAYOUT_VIEWPORT_WIDTH || String(defW), 10) || defW;
    const h = parseInt(process.env.TILE_LAYOUT_VIEWPORT_HEIGHT || String(defH), 10) || defH;
    return { width: Math.max(800, w), height: Math.max(600, h) };
}

/**
 * Headed tiles: emulate full-desktop layout metrics so responsive sites behave like a large monitor,
 * while keeping the OS window at the tiled --window-size. Uses CDP dontSetVisibleSize so Chromium
 * does not expand the browser chrome to match the layout width/height.
 */
async function applyTiledLayoutCdpIfNeeded(page, tiledHeaded) {
    if (!tiledHeaded || process.env.HEADLESS === 'true') return;
    if (!parseBoolEnv(process.env.TILE_CDP_FULL_LAYOUT, true)) return;

    const layout = getTiledLayoutViewportSize();
    try {
        const session = await page.context().newCDPSession(page);
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: layout.width,
            height: layout.height,
            deviceScaleFactor: 1,
            mobile: false,
            screenWidth: layout.width,
            screenHeight: layout.height,
            dontSetVisibleSize: true
        });
        console.log(`[Browser] CDP desktop layout ${layout.width}×${layout.height} (tile window unchanged)`);
    } catch (e) {
        console.warn('[Browser] CDP setDeviceMetricsOverride:', e.message);
    }
}

/**
 * After CDP lays out a “full monitor”, scale the whole document down so it fits in the physical tile
 * (miniature giant-desktop effect). Uses tile metrics + TILE_CHROME_UI_HEIGHT for usable content area.
 */
async function applyTiledMiniatureScale(page, tileMetrics) {
    if (!tileMetrics || process.env.HEADLESS === 'true') return;
    if (!parseBoolEnv(process.env.TILE_SHRINK_FULL_LAYOUT_TO_TILE, true)) return;

    const layout = getTiledLayoutViewportSize();
    const lw = layout.width;
    const lh = layout.height;
    const chromeH = Math.max(0, parseInt(process.env.TILE_CHROME_UI_HEIGHT || '88', 10) || 88);
    const tw = Math.max(80, tileMetrics.cellW);
    const th = Math.max(80, tileMetrics.cellH - chromeH);
    const scale = Math.min(tw / lw, th / lh);

    try {
        await page.evaluate(({ lw, lh, s }) => {
            const html = document.documentElement;
            html.style.transformOrigin = 'top left';
            html.style.width = `${lw}px`;
            html.style.minHeight = `${lh}px`;
            html.style.transform = `scale(${s})`;
            html.style.overflow = 'hidden';
            const b = document.body;
            if (b) {
                b.style.margin = '0';
                b.style.transformOrigin = 'top left';
            }
        }, { lw, lh, s: scale });
        console.log(`[Browser] Miniature fit: scale=${(scale * 100).toFixed(1)}% (${lw}×${lh} → ~${Math.round(lw * scale)}×${Math.round(lh * scale)} in tile)`);
    } catch (e) {
        console.warn('[Browser] Miniature scale:', e.message);
    }
}

const contextOptions = (opts = {}) => {
    let viewport = defaultViewport;
    if (opts.useTiledWindow) {
        // Always null here; large layout comes from CDP (above) so Playwright does not resize OS windows.
        viewport = null;
    }
    return {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport,
        permissions: [],
        geolocation: undefined,
        locale: 'en-US',
        bypassCSP: true,
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive'
        }
    };
};

/** Default: deny (no prompt). Set BILLING_ALLOW_GEOLOCATION=true to allow real location prompts. */
function shouldDenyGeolocation() {
    return !/^(1|true|yes|on)$/i.test(String(process.env.BILLING_ALLOW_GEOLOCATION || '').trim());
}

/**
 * Stub geolocation + permissions query so sites never open Chromium’s location prompt (always PERMISSION_DENIED).
 */
async function installAlwaysDenyGeolocation(ctx) {
    if (!shouldDenyGeolocation()) return;

    await ctx.addInitScript(() => {
        const deniedError = () => ({
            code: 1,
            message: 'User denied Geolocation',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3
        });

        const stubGeo = {
            getCurrentPosition(success, error) {
                Promise.resolve().then(() => {
                    if (typeof error === 'function') error(deniedError());
                });
            },
            watchPosition(success, error) {
                Promise.resolve().then(() => {
                    if (typeof error === 'function') error(deniedError());
                });
                return 0;
            },
            clearWatch() {}
        };

        try {
            Object.defineProperty(navigator, 'geolocation', {
                value: stubGeo,
                configurable: true,
                enumerable: true
            });
        } catch (e1) {
            try {
                navigator.geolocation = stubGeo;
            } catch (e2) { /* ignore */ }
        }

        try {
            const perm = navigator.permissions;
            if (perm && typeof perm.query === 'function') {
                const originalQuery = perm.query.bind(perm);
                perm.query = function (descriptor) {
                    if (descriptor && descriptor.name === 'geolocation') {
                        return Promise.resolve({
                            state: 'denied',
                            status: 'denied',
                            onchange: null,
                            addEventListener() {},
                            removeEventListener() {},
                            dispatchEvent() {
                                return false;
                            }
                        });
                    }
                    return originalQuery(descriptor);
                };
            }
        } catch (e) { /* ignore */ }
    });
}

/**
 * Before page scripts: remove Unite home logo link + Exports nav; keep zapping while DOM churns (demo UI only).
 */
async function installUniteDemoNavStripInitScript(ctx) {
    if (!isPatientUiAnonymizeEnabled()) return;
    await ctx.addInitScript(() => {
        const zap = () => {
            try {
                document.getElementById('nav-home')?.remove();
                document.getElementById('nav-exports')?.remove();
                document.querySelector('a#nav-home')?.remove();
                document.querySelector('li#nav-exports')?.remove();
                document.querySelectorAll('a.home-link[aria-label="Unite Us home"]').forEach((n) => n.remove());
            } catch (e) { /* ignore */ }
        };
        const start = () => {
            zap();
            try {
                if (!window.__demoUniteNavMo) {
                    window.__demoUniteNavMo = new MutationObserver(() => {
                        zap();
                    });
                    window.__demoUniteNavMo.observe(document.documentElement, { childList: true, subtree: true });
                }
            } catch (e) { /* ignore */ }
            if (!window.__demoUniteNavIv) {
                let ticks = 0;
                window.__demoUniteNavIv = setInterval(() => {
                    zap();
                    if (++ticks > 650) {
                        clearInterval(window.__demoUniteNavIv);
                        window.__demoUniteNavIv = null;
                    }
                }, 130);
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
        zap();
    });
}

/** Route handler for a page (block 3rd party, CORS proxy for localhost/external). */
async function setupPageRoutes(p) {
    await p.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();
        if (
            url.includes('app.launchdarkly.com') ||
            url.includes('maps.googleapis.com') ||
            url.includes('intercom.io') ||
            url.includes('api-iam.intercom.io')
        ) {
            return route.abort();
        }
        if (url.includes('localhost') && url.includes('/api/')) {
            try {
                const response = await route.fetch();
                const headers = { ...response.headers() };
                const origin = request.headers()['origin'] || 'https://app.uniteus.io';
                headers['access-control-allow-origin'] = origin;
                headers['access-control-allow-credentials'] = 'true';
                return route.fulfill({ response, headers });
            } catch (e) {
                return route.continue();
            }
        }
        if (!url.includes('uniteus.io') && !url.includes('localhost') && !url.startsWith('data:')) {
            try {
                const response = await route.fetch();
                const headers = { ...response.headers() };
                headers['access-control-allow-origin'] = '*';
                headers['access-control-allow-credentials'] = 'true';
                return route.fulfill({ response, headers });
            } catch (e) {
                return route.continue();
            }
        }
        return route.continue();
    });
}

/** Registry of multi-instance browsers for closeAllBrowserInstances(). */
const instances = new Map();

/**
 * Launch a dedicated browser instance for a slot (parallel mode).
 * @param {number} slotId
 * @param {{ totalSlots?: number }} [tileOpts] — pass totalSlots so headed windows can tile on screen.
 * Returns { browser, context, page, close, restartPage }.
 */
async function launchBrowserInstance(slotId, tileOpts = {}) {
    const totalSlots = tileOpts.totalSlots != null ? tileOpts.totalSlots : 1;
    const tileMetrics = computeTileMetrics(slotId, totalSlots);
    const tileArgs = tileMetrics
        ? [`--window-size=${tileMetrics.cellW},${tileMetrics.cellH}`, `--window-position=${tileMetrics.x},${tileMetrics.y}`]
        : [];
    if (tileMetrics) {
        console.log(`[Browser] Tile slot ${slotId}/${totalSlots} → ${tileMetrics.cellW}×${tileMetrics.cellH} @ (${tileMetrics.x},${tileMetrics.y}) [grid ${tileMetrics.cols}×${tileMetrics.rows}]`);
    }
    const useTiledWindow = tileArgs.length > 0;

    console.log(`[Browser] Launching instance for slot ${slotId}...`);
    const b = await chromium.launch(launchOptions(tileArgs));
    const ctx = await b.newContext(contextOptions({ useTiledWindow }));
    await installAlwaysDenyGeolocation(ctx);
    await installUniteDemoNavStripInitScript(ctx);
    await ctx.grantPermissions([], { origin: 'https://app.uniteus.io' });
    await ctx.clearPermissions();
    const p = await ctx.newPage();
    await setupPageRoutes(p);
    await applyTiledLayoutCdpIfNeeded(p, useTiledWindow);
    await applyTiledMiniatureScale(p, tileMetrics);
    if (useTiledWindow) {
        p.on('load', async () => {
            await applyTiledLayoutCdpIfNeeded(p, true).catch(() => {});
            await applyTiledMiniatureScale(p, tileMetrics).catch(() => {});
        });
    }
    p.on('console', msg => {
        if (msg.type() === 'log') console.log(`[Browser:${slotId}] ${msg.text()}`);
        if (msg.type() === 'warn') console.warn(`[Browser:${slotId}] ${msg.text()}`);
        if (msg.type() === 'error') console.error(`[Browser:${slotId}] ${msg.text()}`);
    });

    const close = async () => {
        instances.delete(slotId);
        try {
            await b.close();
        } catch (e) {
            console.warn(`[Browser:${slotId}] Close error:`, e.message);
        }
    };

    const restartPage = async () => {
        await close();
        const next = await launchBrowserInstance(slotId, { totalSlots });
        return next.page;
    };

    instances.set(slotId, { browser: b, context: ctx, page: p, close });
    return { browser: b, context: ctx, page: p, close, restartPage };
}

async function closeAllBrowserInstances() {
    const slots = Array.from(instances.keys());
    await Promise.all(slots.map(async (slotId) => {
        const inst = instances.get(slotId);
        if (inst && inst.close) await inst.close();
    }));
    instances.clear();
}

async function launchBrowser() {
    if (page) return page;

    console.log('[Browser] Launching Chromium...');
    browser = await chromium.launch(launchOptions());
    context = await browser.newContext(contextOptions());
    await installAlwaysDenyGeolocation(context);
    await installUniteDemoNavStripInitScript(context);
    await context.grantPermissions([], { origin: 'https://app.uniteus.io' });
    await context.clearPermissions();
    page = await context.newPage();
    await setupPageRoutes(page);
    page.on('console', msg => {
        if (msg.type() === 'log') console.log(`[Browser] ${msg.text()}`);
        if (msg.type() === 'warn') console.warn(`[Browser] ${msg.text()}`);
        if (msg.type() === 'error') console.error(`[Browser] ${msg.text()}`);
    });
    return page;
}

async function getPage() {
    if (!page) await launchBrowser();
    return page;
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
        context = null;
        page = null;
    }
}

async function restartBrowser() {
    console.log('[Browser] Restarting browser for fresh session...');
    await closeBrowser();
    return await launchBrowser();
}

module.exports = {
    launchBrowser,
    getPage,
    closeBrowser,
    restartBrowser,
    getContext: () => context,
    launchBrowserInstance,
    closeAllBrowserInstances,
    computeTileMetrics
};
