const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3500;

function ensureUserDataFiles() {
    const userData = app.getPath('userData');
    if (!fs.existsSync(userData)) {
        fs.mkdirSync(userData, { recursive: true });
    }

    const appPath = app.getAppPath();

    // Use bundled Playwright browsers when packaged (no install needed for users)
    if (app.isPackaged) {
        const bundledBrowsers = path.join(process.resourcesPath, 'playwright-browsers');
        if (fs.existsSync(bundledBrowsers)) {
            process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsers;
        }
    }
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
        process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(userData, 'playwright-browsers');
    }

    // Prefer .env next to the app (project root in dev, bundled when packaged) so CONCURRENT_BROWSERS etc. are used
    const appEnv = path.join(appPath, '.env');
    const envDest = path.join(userData, '.env');
    const billingDest = path.join(userData, 'billing_requests.json');

    if (fs.existsSync(appEnv)) {
        process.env.DOTENV_PATH = appEnv;
    } else {
        if (!fs.existsSync(envDest)) {
            const envExample = path.join(appPath, '.env.example');
            if (fs.existsSync(envExample)) {
                fs.copyFileSync(envExample, envDest);
            }
        }
        process.env.DOTENV_PATH = envDest;
    }

    if (!fs.existsSync(billingDest)) {
        const template = path.join(appPath, 'billing_requests_template.json');
        if (fs.existsSync(template)) {
            fs.copyFileSync(template, billingDest);
        }
    }

    process.env.BILLING_REQUESTS_PATH = billingDest;
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    win.loadURL(`http://localhost:${PORT}`);
    win.on('closed', () => {
        app.quit();
    });
}

app.whenReady().then(() => {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
        return;
    }

    ensureUserDataFiles();

    const { start } = require('./src/server');
    start(PORT);

    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});
