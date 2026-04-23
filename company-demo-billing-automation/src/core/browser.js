const { chromium } = require('playwright');
const path = require('path');
const dotenvPath = process.env.DOTENV_PATH || path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: dotenvPath });

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
 * Chromium flags to place each window in a grid so parallel headed slots stay visible.
 * Uses TILE_SCREEN_WIDTH / TILE_SCREEN_HEIGHT (default 1920×1080), TILE_GUTTER, TILE_ORIGIN_*.
 * Set TILE_WINDOWS=false to disable.
 */
function tileWindowLaunchArgs(slotIndex, totalSlots) {
    const headless = process.env.HEADLESS === 'true';
    if (headless || totalSlots <= 1 || !parseBoolEnv(process.env.TILE_WINDOWS, true)) {
        return [];
    }

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

    console.log(`[Browser] Tile slot ${slotIndex}/${totalSlots} → ${cellW}×${cellH} @ (${x},${y}) [grid ${cols}×${rows}]`);
    return [`--window-size=${cellW},${cellH}`, `--window-position=${x},${y}`];
}

/** Shared launch options for Chromium (singleton and multi-instance). */
const launchOptions = (extraArgs = []) => ({
    headless: process.env.HEADLESS === 'true',
    args: [...BASE_CHROMIUM_ARGS, ...extraArgs]
});

const defaultViewport = { width: 1280, height: 800 };

/**
 * Layout viewport for headed tiled slots: each page lays out at this size (CSS / responsive)
 * while the OS window stays small. Pan with scrollbars inside the tile.
 * Defaults to TILE_SCREEN_* (or 1920×1080). Raise TILE_LAYOUT_VIEWPORT_* for ultra-wide layouts.
 */
function getTiledLayoutViewportSize() {
    const defW = Math.max(400, parseInt(process.env.TILE_SCREEN_WIDTH || '1920', 10) || 1920);
    const defH = Math.max(300, parseInt(process.env.TILE_SCREEN_HEIGHT || '1080', 10) || 1080);
    const w = parseInt(process.env.TILE_LAYOUT_VIEWPORT_WIDTH || String(defW), 10) || defW;
    const h = parseInt(process.env.TILE_LAYOUT_VIEWPORT_HEIGHT || String(defH), 10) || defH;
    return { width: Math.max(800, w), height: Math.max(600, h) };
}

const contextOptions = (opts = {}) => {
    const layout = opts.useTiledWindow ? getTiledLayoutViewportSize() : null;
    return {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: layout || defaultViewport,
        ...(layout ? { screen: { width: layout.width, height: layout.height } } : {}),
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
    const tileArgs = tileWindowLaunchArgs(slotId, totalSlots);
    const useTiledWindow = tileArgs.length > 0;

    console.log(`[Browser] Launching instance for slot ${slotId}...`);
    const b = await chromium.launch(launchOptions(tileArgs));
    const ctx = await b.newContext(contextOptions({ useTiledWindow }));
    await ctx.grantPermissions([], { origin: 'https://app.uniteus.io' });
    await ctx.clearPermissions();
    const p = await ctx.newPage();
    await setupPageRoutes(p);
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
    closeAllBrowserInstances
};
