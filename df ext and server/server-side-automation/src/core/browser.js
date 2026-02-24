const { chromium } = require('playwright');
require('dotenv').config();

let browser = null;
let context = null;
let page = null;

async function launchBrowser() {
    if (page) return page;

    console.log('[Browser] Launching Chromium...');
    // HEADED mode by default for debugging/visual verification
    browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Hide automation detection
            '--disable-dev-shm-usage',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials'
        ]
    });

    context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        permissions: [], // Block all permissions by default
        geolocation: undefined, // Ensure no geolocation
        locale: 'en-US',
        bypassCSP: true, // CRITICAL: Allow fetching PDFs from external URLs (mimics Extension privileges)
        // Add extra headers to appear more like a real browser
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive'
        }
    });

    // Explicitly deny permissions
    await context.grantPermissions([], { origin: 'https://app.uniteus.io' });
    await context.clearPermissions();
    // IMPORTANT: Persist storage state if we want to reuse sessions, 
    // BUT for this specific app we are asked to clear cookies aggressively.
    // We will handle clearing manually.

    page = await context.newPage();

    // Block unnecessary third-party requests that cause CORS/CSP errors
    // These services aren't needed for the billing automation
    // Intercept network requests to handling blocking and CORS proxying
    await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();

        // 1. Block unnecessary/problematic 3rd party services (avoids CORS/credentials errors)
        if (
            url.includes('app.launchdarkly.com') ||
            url.includes('maps.googleapis.com') ||
            url.includes('intercom.io') ||
            url.includes('api-iam.intercom.io')
        ) {
            return route.abort();
        }

        // 2a. CORS proxy for requests FROM app.uniteus.io TO localhost (e.g. /api/signatures/.../pdf)
        // The page is on https://app.uniteus.io but fetches our local API; the API has no CORS headers, so we
        // fetch in Node and fulfill with CORS headers so the page can use the response.
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

        // 2b. CORS Proxy for External Files (PDFs, etc.) — not uniteus, not localhost
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

        // 3. Allow everything else (internal app requests)
        return route.continue();
    });

    // Add console log forwarder to see browser logs in node terminal
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
    getContext: () => context
};
