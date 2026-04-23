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

/**
 * @typedef {{
 *   name: string, phoneDisplay: string, telHref: string, phoneDigits10: string, phoneDigits11: string,
 *   street: string, cityLine: string, county: string, dobLine: string, race: string, ethnicity: string,
 *   marital: string, gender: string, lang1: string, lang2: string,
 *   sendingDisplayName: string, sendingEmail: string, sendingCellHtml: string, staffNavLabel: string
 * }} DemoProfilePayload
 */

/** Obvious parody / demo personas — not real patient records */
const DEMO_PROFILES = /** @type {const} */ ([
    { name: 'DEMO — Winston Churchill', phoneDisplay: '(555) 010-2001', telHref: 'tel:+15550102001', phoneDigits10: '5550102001', phoneDigits11: '15550102001', street: '10 Downing Demo Rd', cityLine: 'Westminster-ish, ZZ 00001', county: 'Blitz Spirit Demo County', dobLine: '11/30/1874 (Age: fake demo)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Married to paperwork (demo)', gender: 'Demo character', lang1: 'Spoken: Churchillian bluster (fake)', lang2: 'Written: Typewriter noise (fake)' },
    { name: 'DEMO — Abraham Lincoln', phoneDisplay: '(555) 010-2002', telHref: 'tel:+15550102002', phoneDigits10: '5550102002', phoneDigits11: '15550102002', street: '1600 Log Cabin Demo Ave', cityLine: 'Springfield-demo, IL 00002', county: 'Top Hat Demo County', dobLine: '2/12/1809 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Single (satire)', gender: 'Demo character', lang1: 'Spoken: Gettysburg emoji voice (fake)', lang2: 'Written: Tall tales (fake)' },
    { name: 'DEMO — George Washington', phoneDisplay: '(555) 010-2003', telHref: 'tel:+15550102003', phoneDigits10: '5550102003', phoneDigits11: '15550102003', street: '1 Cherry Tree Demo Ln', cityLine: 'Mount Vernon-demo, VA 00003', county: 'Delaware Crossing Demo Co.', dobLine: '2/22/1732 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Married to Martha (demo)', gender: 'Demo character', lang1: 'Spoken: Wooden teeth ASMR (fake)', lang2: 'Written: Ref cannot tell a lie (fake)' },
    { name: 'DEMO — Eleanor Roosevelt', phoneDisplay: '(555) 010-2004', telHref: 'tel:+15550102004', phoneDigits10: '5550102004', phoneDigits11: '15550102004', street: 'Hyde Park Demo Cottage', cityLine: 'Hudson Valley-demo, NY 00004', county: 'Universal Declaration Demo Co.', dobLine: '10/11/1884 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Widowed (satire)', gender: 'Demo character', lang1: 'Spoken: Fireside podcast (fake)', lang2: 'Written: Human rights erasers (fake)' },
    { name: 'DEMO — Frida Kahlo', phoneDisplay: '(555) 010-2005', telHref: 'tel:+15550102005', phoneDigits10: '5550102005', phoneDigits11: '15550102005', street: 'La Casa Azul Demo', cityLine: 'Coyoacán-demo, MX 00005', county: 'Surrealist Demo County', dobLine: '7/6/1907 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Complicated (demo)', gender: 'Demo character', lang1: 'Spoken: Monobrow manifesto (fake)', lang2: 'Written: Brush strokes only (fake)' },
    { name: 'DEMO — Albert Einstein', phoneDisplay: '(555) 010-2006', telHref: 'tel:+15550102006', phoneDigits10: '5550102006', phoneDigits11: '15550102006', street: '76 Princeton Demo Hall', cityLine: 'Spacetime-demo, NJ 00006', county: 'Relativity Demo Borough', dobLine: '3/14/1879 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Thought experiment (demo)', gender: 'Demo character', lang1: 'Spoken: Tongue-out equations (fake)', lang2: 'Written: E = mc demo (fake)' },
    { name: 'DEMO — Cleopatra VII', phoneDisplay: '(555) 010-2007', telHref: 'tel:+15550102007', phoneDigits10: '5550102007', phoneDigits11: '15550102007', street: '1 Nile Barge Demo Dock', cityLine: 'Alexandria-demo, EG 00007', county: 'Asp Demo County', dobLine: '69 BCE (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'It’s complicated (demo)', gender: 'Demo character', lang1: 'Spoken: Hieroglyph karaoke (fake)', lang2: 'Written: Papyrus memes (fake)' },
    { name: 'DEMO — Leonardo da Vinci', phoneDisplay: '(555) 010-2008', telHref: 'tel:+15550102008', phoneDigits10: '5550102008', phoneDigits11: '15550102008', street: 'Via Vinci Demo Studio', cityLine: 'Florence-demo, IT 00008', county: 'Helicopter Sketch Demo Co.', dobLine: '4/15/1452 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Busy inventing (demo)', gender: 'Demo character', lang1: 'Spoken: Mirror writing (fake)', lang2: 'Written: Backwards Italian (fake)' },
    { name: 'DEMO — Franklin D. Roosevelt', phoneDisplay: '(555) 010-2009', telHref: 'tel:+15550102009', phoneDigits10: '5550102009', phoneDigits11: '15550102009', street: 'Hyde Park Demo Wheelchair Ramp', cityLine: 'Warm Springs-demo, GA 00009', county: 'New Deal Demo County', dobLine: '1/30/1882 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Eleanor not included (demo)', gender: 'Demo character', lang1: 'Spoken: Fireside chalkboard (fake)', lang2: 'Written: Nothing to fear but demos (fake)' },
    { name: 'DEMO — Nelson Mandela', phoneDisplay: '(555) 010-2010', telHref: 'tel:+15550102010', phoneDigits10: '5550102010', phoneDigits11: '15550102010', street: 'Vilakazi St Demo House', cityLine: 'Soweto-demo, ZA 00010', county: 'Madiba Demo Municipality', dobLine: '7/18/1918 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Free at last (demo)', gender: 'Demo character', lang1: 'Spoken: Invictus outtakes (fake)', lang2: 'Written: Rainbow nation Lorem (fake)' },
    { name: 'DEMO — Marie Curie', phoneDisplay: '(555) 010-2011', telHref: 'tel:+15550102011', phoneDigits10: '5550102011', phoneDigits11: '15550102011', street: 'Radium Alley Demo Lab', cityLine: 'Paris-demo, FR 00011', county: 'Radioactive Demo County', dobLine: '11/7/1867 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Married to science (demo)', gender: 'Demo character', lang1: 'Spoken: Glow-in-the-dark French (fake)', lang2: 'Written: Nobel receipt (fake)' },
    { name: 'DEMO — Ada Lovelace', phoneDisplay: '(555) 010-2012', telHref: 'tel:+15550102012', phoneDigits10: '5550102012', phoneDigits11: '15550102012', street: 'Analytical Engine Demo Loft', cityLine: 'London-demo, UK 00012', county: 'First Programmer Demo Co.', dobLine: '12/10/1815 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Married to loops (demo)', gender: 'Demo character', lang1: 'Spoken: Punch card poetry (fake)', lang2: 'Written: while(true) joke (fake)' },
    { name: 'DEMO — Charles Darwin', phoneDisplay: '(555) 010-2013', telHref: 'tel:+15550102013', phoneDigits10: '5550102013', phoneDigits11: '15550102013', street: 'Down House Demo Beetle Shed', cityLine: 'Kent-demo, UK 00013', county: 'Natural Selection Demo Co.', dobLine: '2/12/1809 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Finches everywhere (demo)', gender: 'Demo character', lang1: 'Spoken: Finch accent (fake)', lang2: 'Written: Origin of Demos (fake)' },
    { name: 'DEMO — Joan of Arc', phoneDisplay: '(555) 010-2014', telHref: 'tel:+15550102014', phoneDigits10: '5550102014', phoneDigits11: '15550102014', street: 'Orléans Demo Bastion', cityLine: 'Domrémy-demo, FR 00014', county: 'Hundred Years Demo County', dobLine: '1/6/1412 (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Canonized satire (demo)', gender: 'Demo character', lang1: 'Spoken: Voices in UI tests (fake)', lang2: 'Written: Trial transcript redacted (fake)' },
    { name: 'DEMO — Julius Caesar', phoneDisplay: '(555) 010-2015', telHref: 'tel:+15550102015', phoneDigits10: '5550102015', phoneDigits11: '15550102015', street: 'Rubicon Creek Demo Ford', cityLine: 'Rome-demo, IT 00015', county: 'Et tu Demo County', dobLine: '7/12/100 BC (Age: demo only)', race: 'Demo: not a patient', ethnicity: 'Demo: parody only', marital: 'Brutus was busy (demo)', gender: 'Demo character', lang1: 'Spoken: Veni vidi demo (fake)', lang2: 'Written: Ides of March spreadsheet (fake)' }
]);

function profileIndexForUrl(url) {
    const s = String(url || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return Math.abs(h) % DEMO_PROFILES.length;
}

function isEnabled() {
    return /^(1|true|yes|on)$/i.test(String(process.env.DEMO_ANONYMIZE_PATIENT_UI || '').trim());
}

/**
 * @param {import('playwright').Page} page
 * @param {((type: string, data: unknown) => void) | null} emitEvent
 * @param {string} slotLabel
 */
async function anonymizePatientUi(page, emitEvent, slotLabel = '') {
    if (!isEnabled()) return { applied: false, reason: 'disabled' };

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
        await page.waitForSelector(
            '.contact-column__name, .contact-column, #basic-table-sending-user-value, .right-nav__user-name',
            { timeout: 15000 }
        ).catch(() => {});
        const summary = await page.evaluate((demoProfile) => {
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

            const nameEl =
                document.querySelector('.contact-column .contact-column__name') ||
                document.querySelector('h3.contact-column__name');
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
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            let node;
            while ((node = walk.nextNode())) {
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

            let attrs = 0;
            document.querySelectorAll('[href]').forEach((el) => {
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

            document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]), textarea').forEach((el) => {
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

            return {
                globalPatterns: uniq.length,
                textNodes,
                attrsPatched: attrs,
                hadName: !!extractedName
            };
        }, demoPayload);

        if (emitEvent) {
            emitEvent('log', {
                message: `${prefix}[Demo] Patient UI anonymized — profile ${profileIdx + 1}/15: ${profile.name} (${summary.globalPatterns} patterns, ${summary.textNodes} text nodes).`,
                type: 'info'
            });
        }
        return { applied: true, profileIndex: profileIdx, profileName: profile.name, ...summary };
    } catch (err) {
        if (emitEvent) {
            emitEvent('log', { message: `${prefix}[Demo] Patient anonymize error: ${err.message}`, type: 'warning' });
        }
        return { applied: false, error: err.message };
    }
}

module.exports = {
    anonymizePatientUi,
    isPatientUiAnonymizeEnabled: isEnabled,
    DEMO_PROFILES,
    profileIndexForUrl
};
