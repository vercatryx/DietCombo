/**
 * Demo / video mode: read PHI from the Unite Us contact column, then replace those strings
 * across the visible document (and common attributes) with dummy values.
 * Enable with DEMO_ANONYMIZE_PATIENT_UI=true in .env
 *
 * Fifteen rotating profiles (famous names + "DEMO") so multi-slot runs are visibly fake data.
 */

const path = require('path');
const dotenvPath = process.env.DOTENV_PATH || path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: dotenvPath });
const { DEMO_PROFILES } = require('../demoPersonas');

/**
 * @typedef {{
 *   name: string, phoneDisplay: string, telHref: string, phoneDigits10: string, phoneDigits11: string,
 *   street: string, cityLine: string, county: string, dobLine: string, race: string, ethnicity: string,
 *   marital: string, gender: string, lang1: string, lang2: string,
 *   sendingDisplayName: string, sendingEmail: string, sendingCellHtml: string, staffNavLabel: string
 * }} DemoProfilePayload
 */

function profileIndexForUrl(url) {
    const s = String(url || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return Math.abs(h) % DEMO_PROFILES.length;
}

/** Env tri-state: unset | true | false */
function envTriState(key) {
    const raw = process.env[key];
    if (raw == null || String(raw).trim() === '') return null;
    const s = String(raw).trim();
    if (/^(0|false|no|off)$/i.test(s)) return false;
    if (/^(1|true|yes|on)$/i.test(s)) return true;
    return null;
}

/**
 * Off unless explicitly enabled, or inherited from DEMO_SAFE_QUEUE when DEMO_ANONYMIZE_PATIENT_UI is unset.
 */
function patientUiAnonymizationEnabled() {
    const explicit = envTriState('DEMO_ANONYMIZE_PATIENT_UI');
    const safeQueue = envTriState('DEMO_SAFE_QUEUE');
    if (explicit === true) return true;
    if (explicit === false) return false;
    return safeQueue === true;
}

/** When unset: on only if DEMO_SAFE_QUEUE is on (recording mode). */
function demoDomMutationGuardEnabled() {
    const raw = process.env.DEMO_ANONYMIZE_DOM_GUARD;
    if (raw != null && String(raw).trim() !== '') {
        return /^(1|true|yes|on)$/i.test(String(raw).trim());
    }
    return envTriState('DEMO_SAFE_QUEUE') === true;
}

function parseDelaySchedule(envKey, fallbackCsv) {
    const raw = process.env[envKey];
    const csv = (raw != null && String(raw).trim() !== '') ? String(raw).trim() : fallbackCsv;
    const parts = csv.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);
    return parts.length ? parts : [0, 1200, 3200];
}

/**
 * Remove Unite left-nav / header chrome (home logo link, Exports). Safe to call before DOM is ready and on every pass.
 */
async function stripUniteDemoNavFromPage(page) {
    if (!patientUiAnonymizationEnabled()) return;
    await page.evaluate(() => {
        try {
            document.getElementById('nav-home')?.remove();
            document.getElementById('nav-exports')?.remove();
            document.querySelector('a#nav-home')?.remove();
            document.querySelector('li#nav-exports')?.remove();
            document.querySelectorAll('a.home-link[aria-label="Unite Us home"]').forEach((n) => n.remove());
        } catch (e) { /* ignore */ }
    });
}

/** Rapid passes early (ms from navigation), then slower tail — minimizes visible PHI during React hydrate. */
const DEFAULT_SETTLE_MS =
    '0,18,35,55,78,105,135,170,210,255,305,365,435,520,620,740,880,1050,1250,1500,1800,2150,2550,3050,3700,4500,5500';

/** After billing UI: tight bursts so form-driven updates do not linger. */
const DEFAULT_POST_MS = '0,18,40,68,100,140,190,250,325,420,540,690,880,1150,1500';

/**
 * Several passes while React/Unite finishes hydrating (single pass often gets overwritten).
 */
async function anonymizePatientUiAfterSettling(page, emitEvent, slotLabel = '') {
    if (!patientUiAnonymizationEnabled()) return;
    const schedule = parseDelaySchedule('DEMO_ANONYMIZE_SETTLE_MS', DEFAULT_SETTLE_MS);
    for (let i = 0; i < schedule.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, schedule[i] - schedule[i - 1]));
        await stripUniteDemoNavFromPage(page).catch(() => {});
        await anonymizePatientUi(page, i === 0 ? emitEvent : null, slotLabel);
    }
}

/** After billing shelf / form interactions (DOM churn). */
async function anonymizePatientUiBrief(page, emitEvent, slotLabel = '') {
    if (!patientUiAnonymizationEnabled()) return;
    const schedule = parseDelaySchedule('DEMO_ANONYMIZE_POST_MS', DEFAULT_POST_MS);
    for (let i = 0; i < schedule.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, schedule[i] - schedule[i - 1]));
        await stripUniteDemoNavFromPage(page).catch(() => {});
        await anonymizePatientUi(page, i === 0 ? emitEvent : null, slotLabel);
    }
}

const demoExposeInstalled = new WeakMap();
const demoPingThrottle = new WeakMap();

/**
 * Re-run anonymization when the SPA mutates the tree (optional; recommended with DEMO_SAFE_QUEUE).
 */
async function maybeInstallDemoDomGuard(page, emitEvent, slotLabel = '') {
    if (!patientUiAnonymizationEnabled() || !demoDomMutationGuardEnabled()) return;

    const throttleMs = Math.max(50, parseInt(process.env.DEMO_ANONYMIZE_GUARD_THROTTLE_MS || '180', 10) || 180);

    if (!demoExposeInstalled.has(page)) {
        demoExposeInstalled.set(page, true);
        await page.exposeFunction('__demoPatientUiPing', async () => {
            const last = demoPingThrottle.get(page) || 0;
            const now = Date.now();
            if (now - last < throttleMs) return;
            demoPingThrottle.set(page, now);
            await stripUniteDemoNavFromPage(page).catch(() => {});
            await anonymizePatientUi(page, null, slotLabel);
        });
    }

    const debounceMs = Math.max(0, parseInt(process.env.DEMO_ANONYMIZE_GUARD_DEBOUNCE_MS || '60', 10) || 60);

    await page.evaluate((debounce) => {
        if (window.__demoPatientUiMo) {
            try {
                window.__demoPatientUiMo.disconnect();
            } catch (e) {
                /* ignore */
            }
        }
        let t = 0;
        const debounced = () => {
            clearTimeout(t);
            t = setTimeout(() => {
                if (window.__demoPatientUiPing) window.__demoPatientUiPing().catch(() => {});
            }, debounce);
        };
        window.__demoPatientUiMo = new MutationObserver(debounced);
        window.__demoPatientUiMo.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['href', 'title', 'aria-label', 'value']
        });
        debounced();
    }, debounceMs);
}

/**
 * @param {import('playwright').Page} page
 * @param {((type: string, data: unknown) => void) | null} emitEvent
 * @param {string} slotLabel
 */
async function anonymizePatientUi(page, emitEvent, slotLabel = '') {
    if (!patientUiAnonymizationEnabled()) return { applied: false, reason: 'disabled' };

    const prefix = slotLabel ? `[${slotLabel}] ` : '';
    const profileIdx = profileIndexForUrl(page.url());
    const profile = DEMO_PROFILES[profileIdx];
    const sendingNo = profileIdx + 1;
    /** @type {DemoProfilePayload} */
    const demoPayload = {
        ...profile,
        sendingDisplayName: `DEMO · Sending user ${sendingNo}`,
        sendingEmail: `unite-sender-${sendingNo}@demo.invalid`,
        staffNavLabel: `DEMO · Session user ${sendingNo}`,
        sendingCellHtml: ''
    };
    demoPayload.sendingCellHtml = `${demoPayload.sendingDisplayName}<div><div>Email: ${demoPayload.sendingEmail}</div></div>`;

    try {
        await stripUniteDemoNavFromPage(page).catch(() => {});
        await page.waitForSelector(
            '.contact-column__name, .contact-column, #basic-table-sending-user-value, .right-nav__user-name',
            { timeout: Math.min(15000, Math.max(200, parseInt(process.env.DEMO_ANONYMIZE_WAIT_MS || '700', 10) || 700)) }
        ).catch(() => {});
        const summary = await page.evaluate((demoProfile) => {
            try {
                document.getElementById('nav-home')?.remove();
                document.getElementById('nav-exports')?.remove();
                document.querySelector('a#nav-home')?.remove();
                document.querySelector('li#nav-exports')?.remove();
                document.querySelectorAll('a.home-link[aria-label="Unite Us home"]').forEach((n) => n.remove());
            } catch (e) { /* ignore */ }

            const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
            const digits = (s) => String(s || '').replace(/\D+/g, '');

            /** @type {{ from: string, to: string }[]} */
            const globalPairs = [];
            const addGlobal = (from, to) => {
                const f = norm(from);
                const t = norm(to);
                if (f && t && f !== t && f.length >= 2) globalPairs.push({ from: f, to: t });
            };

            const DUMMY_NAME = demoProfile.name;
            const DUMMY_PHONE_DISPLAY = demoProfile.phoneDisplay;
            const DUMMY_TEL = demoProfile.telHref;
            const DUMMY_DOB_LINE = demoProfile.dobLine;
            const addrDemoLines = [demoProfile.street, demoProfile.cityLine, demoProfile.county];

            const sendCell = document.querySelector('#basic-table-sending-user-value');
            const navEl = document.querySelector('.right-nav__user-name');

            function resolvePatientNameEl() {
                const selectors = [
                    '.contact-column .contact-column__name',
                    'h3.contact-column__name',
                    '.contact-column__name',
                    '[data-test-element="patient_profile_name"]',
                    '[data-test-element*="participant_name" i]',
                    '[data-test-element*="contact_name" i]'
                ];
                for (const sel of selectors) {
                    try {
                        const el = document.querySelector(sel);
                        const t = norm(el?.textContent || '');
                        if (el && t.length >= 3) return /** @type {HTMLElement} */ (el);
                    } catch (e) {
                        /* invalid selector in older browsers */
                    }
                }
                const contactCol = document.querySelector('.contact-column');
                if (contactCol) {
                    const h = contactCol.querySelector('h1, h2, h3, [role="heading"]');
                    const t = norm(h?.textContent || '');
                    if (h && t.length >= 3 && !/^contacts?$/i.test(t)) return /** @type {HTMLElement} */ (h);
                }
                return null;
            }

            const nameEl = resolvePatientNameEl();
            const extractedName = norm(nameEl?.textContent);

            const phoneSpan = document.querySelector("[data-test-element='phone-numbers_number_0']") ||
                document.querySelector('[data-test-element^="phone-numbers_number"]');
            const rawPhone = norm(phoneSpan?.textContent);
            const telA = document.querySelector('.ui-contact-information__compact-phone a[href^="tel:"]');
            const telHrefDigits = digits(telA?.getAttribute('href') || '');

            if (sendCell) {
                const sendText = norm(sendCell.innerText || sendCell.textContent || '');
                const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
                const emails = sendText.match(emailRegex);
                if (emails) {
                    const seenE = new Set();
                    for (const e of emails) {
                        if (e && !seenE.has(e)) {
                            seenE.add(e);
                            addGlobal(e, demoProfile.sendingEmail);
                            addGlobal(`mailto:${e}`, `mailto:${demoProfile.sendingEmail}`);
                        }
                    }
                }
                const withoutEmail = sendText.replace(/\s*Email:.*$/is, '').trim();
                if (withoutEmail.length >= 2) addGlobal(withoutEmail, demoProfile.sendingDisplayName);
                const bundledSend = norm(`${demoProfile.sendingDisplayName} Email: ${demoProfile.sendingEmail}`);
                if (sendText.length >= 8) addGlobal(sendText, bundledSend);
            }

            if (navEl) {
                const navName = norm(navEl.textContent || '');
                if (navName.length >= 2) addGlobal(navName, demoProfile.staffNavLabel);
            }

            // --- 1) Build global replace list from real values (before mutating nodes) ---
            if (extractedName.length >= 3) addGlobal(extractedName, DUMMY_NAME);

            const dPhone = digits(rawPhone) || telHrefDigits;
            if (dPhone.length >= 10) {
                const d10 = dPhone.length === 11 && dPhone.startsWith('1') ? dPhone.slice(1) : dPhone;
                const formatted = d10.length === 10
                    ? `(${d10.slice(0, 3)}) ${d10.slice(3, 6)}-${d10.slice(6)}`
                    : rawPhone;
                if (formatted && formatted.length >= 8) addGlobal(formatted, DUMMY_PHONE_DISPLAY);
                addGlobal(d10, demoProfile.phoneDigits10);
                addGlobal(dPhone, dPhone.length === 11 ? demoProfile.phoneDigits11 : demoProfile.phoneDigits10);
                if (telA) {
                    const href = telA.getAttribute('href') || '';
                    if (href.startsWith('tel:')) addGlobal(href, DUMMY_TEL);
                }
            }

            const addrRoot = document.querySelector('.address .address__details');
            if (addrRoot) {
                let addrIdx = 0;
                addrRoot.querySelectorAll('p').forEach((p) => {
                    const t = norm(p.textContent);
                    if (!t || /^primary$/i.test(t)) return;
                    const isCounty = p.classList.contains('county') || /county/i.test(t);
                    const to = isCounty ? demoProfile.county : (addrDemoLines[Math.min(addrIdx++, addrDemoLines.length - 1)] || '—');
                    if (t.length >= 4) addGlobal(t, to);
                });
            }

            const dobEl = document.querySelector('#dob');
            const dobText = norm(dobEl?.innerText || dobEl?.textContent || '');
            if (dobText.length >= 6) addGlobal(dobText, DUMMY_DOB_LINE);

            for (const sel of ['#race', '#ethnicity', '#marital_status', '#gender']) {
                const el = document.querySelector(sel);
                const t = norm(el?.textContent || '');
                if (t.length >= 4) {
                    const key = sel.slice(1);
                    const rep =
                        key === 'race' ? demoProfile.race
                            : key === 'ethnicity' ? demoProfile.ethnicity
                                : key === 'marital_status' ? demoProfile.marital
                                    : demoProfile.gender;
                    addGlobal(t, rep);
                }
            }
            const langElPre = document.querySelector('#languages');
            if (langElPre) {
                const lt = norm(langElPre.innerText || langElPre.textContent || '');
                const bundled = norm(`${demoProfile.lang1} ${demoProfile.lang2}`);
                if (lt.length >= 8) addGlobal(lt, bundled);
            }

            // --- 2) Direct rewrites on known nodes (short field values) ---
            if (nameEl) nameEl.textContent = DUMMY_NAME;

            document.querySelectorAll('[data-test-element^="phone-numbers_number"]').forEach((span) => {
                span.textContent = DUMMY_PHONE_DISPLAY;
            });

            document.querySelectorAll('.ui-contact-information__compact-phone a[href^="tel:"]').forEach((a) => {
                a.setAttribute('href', DUMMY_TEL);
                const inner = a.querySelector('span[data-test-element^="phone-numbers_number"]');
                if (inner) inner.textContent = DUMMY_PHONE_DISPLAY;
                else a.textContent = DUMMY_PHONE_DISPLAY;
            });

            if (addrRoot) {
                let i = 0;
                addrRoot.querySelectorAll('p').forEach((p) => {
                    const t = norm(p.textContent);
                    if (!t || /^primary$/i.test(t)) return;
                    const isCounty = p.classList.contains('county') || /county/i.test(t);
                    p.textContent = isCounty ? demoProfile.county : (addrDemoLines[Math.min(i++, addrDemoLines.length - 1)] || '—');
                });
            }

            const setTextIfPresent = (sel, text) => {
                const el = document.querySelector(sel);
                if (el) el.textContent = text;
            };
            setTextIfPresent('#dob', DUMMY_DOB_LINE);
            setTextIfPresent('#race', demoProfile.race);
            setTextIfPresent('#ethnicity', demoProfile.ethnicity);
            setTextIfPresent('#marital_status', demoProfile.marital);
            setTextIfPresent('#gender', demoProfile.gender);

            const langEl = document.querySelector('#languages');
            if (langEl) {
                const inner = langEl.querySelector('.content') || langEl;
                inner.innerHTML = `<div class="flex flex-col space-y-2"><div>${demoProfile.lang1}</div><div>${demoProfile.lang2}</div></div>`;
            }

            const uniq = [];
            const seen = new Set();
            globalPairs
                .sort((a, b) => b.from.length - a.from.length)
                .forEach((p) => {
                    if (seen.has(p.from)) return;
                    seen.add(p.from);
                    uniq.push(p);
                });

            const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
            let textNodes = 0;

            /** Tree + open shadow roots (Unite components often hide text in shadow DOM). */
            function walkShadowRoots(root, visitor) {
                visitor(root);
                root.querySelectorAll('*').forEach((el) => {
                    if (el.shadowRoot) walkShadowRoots(el.shadowRoot, visitor);
                });
            }

            walkShadowRoots(document.body, (subRoot) => {
                const tw = document.createTreeWalker(subRoot, NodeFilter.SHOW_TEXT, null);
                let node;
                while ((node = tw.nextNode())) {
                    const parent = node.parentElement;
                    if (!parent || skipTags.has(parent.tagName)) continue;
                    let cur = node.nodeValue;
                    if (!cur || !cur.trim()) continue;
                    let next = cur;
                    for (const { from, to } of uniq) {
                        if (from.length >= 2 && next.includes(from)) next = next.split(from).join(to);
                    }
                    if (next !== cur) {
                        node.nodeValue = next;
                        textNodes++;
                    }
                }
            });

            let attrs = 0;
            walkShadowRoots(document.body, (subRoot) => {
                subRoot.querySelectorAll('[href]').forEach((el) => {
                    const h = el.getAttribute('href');
                    if (!h) return;
                    let nh = h;
                    if (h.startsWith('tel:')) {
                        nh = DUMMY_TEL;
                    } else {
                        for (const { from, to } of uniq) {
                            if (from.length >= 2 && nh.includes(from)) nh = nh.split(from).join(to);
                        }
                    }
                    if (nh !== h) {
                        el.setAttribute('href', nh);
                        attrs++;
                    }
                });

                subRoot.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]), textarea').forEach((el) => {
                    let v = el.value;
                    if (!v || !v.trim()) return;
                    let nv = v;
                    for (const { from, to } of uniq) {
                        if (from.length >= 2 && nv.includes(from)) nv = nv.split(from).join(to);
                    }
                    if (extractedName.length >= 3 && nv.includes(extractedName)) nv = nv.split(extractedName).join(DUMMY_NAME);
                    if (nv !== v) {
                        el.value = nv;
                        attrs++;
                    }
                });
            });

            return {
                globalPatterns: uniq.length,
                textNodes,
                attrsPatched: attrs,
                hadName: !!extractedName
            };
        }, demoPayload);

        if (emitEvent) {
            emitEvent('log', {
                message: `${prefix}[Demo] Patient UI anonymized — profile ${profileIdx + 1}/${DEMO_PROFILES.length}: ${profile.name} (${summary.globalPatterns} patterns, ${summary.textNodes} text nodes).`,
                type: 'info'
            });
        }
        return { applied: true, profileIndex: profileIdx, profileName: profile.name, ...summary };
    } catch (err) {
        /* Bursts run often; failures are expected until DOM is ready — do not spam the activity log. */
        return { applied: false, error: err.message };
    }
}

module.exports = {
    anonymizePatientUi,
    anonymizePatientUiAfterSettling,
    anonymizePatientUiBrief,
    maybeInstallDemoDomGuard,
    stripUniteDemoNavFromPage,
    isPatientUiAnonymizeEnabled: patientUiAnonymizationEnabled,
    DEMO_PROFILES,
    profileIndexForUrl
};
