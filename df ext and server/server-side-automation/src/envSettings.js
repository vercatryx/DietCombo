const fs = require('fs');
const path = require('path');

const DEFAULT_CONCURRENT = 10;
const DEFAULT_HEADLESS = true;
const MIN_CONCURRENT = 1;
const MAX_CONCURRENT = 50;

function getEnvFilePath() {
    return process.env.DOTENV_PATH || path.join(__dirname, '..', '.env');
}

function parseEnvLine(key, content) {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'mi');
    const m = content.match(re);
    if (!m) return null;
    return m[1].replace(/^["']|["']$/g, '').trim();
}

function readSettings() {
    const envFilePath = getEnvFilePath();
    const envDir = path.dirname(envFilePath);
    let concurrentBrowsers = DEFAULT_CONCURRENT;
    let headless = DEFAULT_HEADLESS;

    if (fs.existsSync(envFilePath)) {
        const content = fs.readFileSync(envFilePath, 'utf8');
        const c = parseEnvLine('CONCURRENT_BROWSERS', content);
        if (c != null && c !== '') {
            const n = parseInt(c, 10);
            if (Number.isFinite(n)) concurrentBrowsers = Math.min(MAX_CONCURRENT, Math.max(MIN_CONCURRENT, n));
        }
        const h = parseEnvLine('HEADLESS', content);
        if (h != null && h !== '') {
            headless = /^true$/i.test(h);
        }
    } else {
        const fromProc = parseInt(process.env.CONCURRENT_BROWSERS, 10);
        if (Number.isFinite(fromProc)) {
            concurrentBrowsers = Math.min(MAX_CONCURRENT, Math.max(MIN_CONCURRENT, fromProc));
        }
        if (process.env.HEADLESS != null && process.env.HEADLESS !== '') {
            headless = /^true$/i.test(String(process.env.HEADLESS));
        }
    }

    return {
        concurrentBrowsers,
        headless,
        envFilePath,
        envDir
    };
}

function applyToProcessEnv(concurrentBrowsers, headless) {
    process.env.CONCURRENT_BROWSERS = String(concurrentBrowsers);
    process.env.HEADLESS = headless ? 'true' : 'false';
}

/**
 * Update CONCURRENT_BROWSERS and/or HEADLESS in the .env file.
 * Preserves other lines; replaces existing keys or appends at end.
 * Only keys present on `updates` are written.
 */
function writeSettings(updates) {
    if (updates.concurrentBrowsers == null && updates.headless == null) {
        throw new Error('No settings to update');
    }

    const envFilePath = getEnvFilePath();
    const envDir = path.dirname(envFilePath);
    if (!fs.existsSync(envDir)) {
        fs.mkdirSync(envDir, { recursive: true });
    }

    const current = readSettings();
    const nextConcurrent =
        updates.concurrentBrowsers != null
            ? Math.min(MAX_CONCURRENT, Math.max(MIN_CONCURRENT, parseInt(updates.concurrentBrowsers, 10) || MIN_CONCURRENT))
            : current.concurrentBrowsers;
    const nextHeadless = updates.headless != null ? Boolean(updates.headless) : current.headless;

    let lines = [];
    if (fs.existsSync(envFilePath)) {
        lines = fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/);
    }

    const setKey = (key, value) => {
        const esc = String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
        const newLine = `${key}=${esc}`;
        const keyRe = new RegExp(`^\\s*${key}\\s*=`);
        let found = false;
        for (let i = 0; i < lines.length; i++) {
            if (keyRe.test(lines[i])) {
                lines[i] = newLine;
                found = true;
                break;
            }
        }
        if (!found) {
            if (lines.length && lines[lines.length - 1] !== '') lines.push('');
            lines.push(newLine);
        }
    };

    if (updates.concurrentBrowsers != null) {
        setKey('CONCURRENT_BROWSERS', String(nextConcurrent));
    }
    if (updates.headless != null) {
        setKey('HEADLESS', nextHeadless ? 'true' : 'false');
    }

    const body = lines.join('\n').replace(/\n+$/, '') + '\n';
    fs.writeFileSync(envFilePath, body, 'utf8');

    applyToProcessEnv(nextConcurrent, nextHeadless);

    return {
        concurrentBrowsers: nextConcurrent,
        headless: nextHeadless,
        envFilePath,
        envDir
    };
}

function openEnvFolder() {
    const { spawn } = require('child_process');
    const envFilePath = getEnvFilePath();
    const dir = path.dirname(envFilePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const platform = process.platform;
    if (platform === 'darwin') {
        spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
        spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref();
    } else {
        spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
    }
}

module.exports = {
    getEnvFilePath,
    readSettings,
    writeSettings,
    applyToProcessEnv,
    openEnvFolder,
    MIN_CONCURRENT,
    MAX_CONCURRENT,
    DEFAULT_CONCURRENT,
    DEFAULT_HEADLESS
};
