# Full demo — teleprompter script (VO + screen cues)

**What this is for:** A single read-through you can record as one video (or cut into chapters). On-screen data is **fictional**; integrations and **workflow patterns** are what you really sell — we **inject** fake data into the same *kinds* of real platforms we use in production.  
**Tone:** Credible, concrete, a little warm — you’re a technology company **showing capability**, not selling one SKU.  
**Rough total (full read):** ~19–27 minutes at a comfortable pace; sections note where to **trim** for a 10–12 minute cut.  
**Related:** See also `docs/VIDEO_SCRIPT_DEMO.md` (shorter, older storyboard) — this file is the **long-form teleprompter**.

**Recording setup:** Keep water nearby; **pause** on the lines marked **[PAUSE]**. B-roll can cover trims.

---

## How to use this file

- `**[VO]`** = read this line as voiceover (or to camera).  
- `**[SCREEN: …]`** = what should be on screen; adjust to your build names (`record-demo-web`, `sms-demo`, billing UI, etc.).  
- **Times in headers** = targets only — speak at your own speed.

---

# SECTION 0 — OPEN: WHY THIS VIDEO (AND HONEST DEMOS) ARE HARD  (~1:30–2:00)

**[VO]** For a long time, people have asked us for a real demo. I’ve wanted to show you one. One reason it’s **hard in our line of work** is that we don’t ship a little island of software — we use **a lot of integrations**: connections into **real billing and clearing systems**, **real service and operations platforms**, **telephony and messaging** providers, **portals** we don’t own, and often **vendors’ own tools** on the other side. The value is in **moving work across those systems** — and that’s exactly what makes a “tidy screen recording” complicated.

**[VO]** We **don’t control the database** on someone else’s billing or payer platform. The names, line items, and proof documents in those environments are **our clients’ data** — and we are not about to point a camera at **their** production tenants for a marketing video. So there is no **normal, honest** way to “just show the product” end to end the way you would with a fake SaaS that lives entirely on our own servers, **without** either exposing a client or lying about what’s on screen.

**[VO — still true, and universal]** On top of that, the same old rules still apply: **PII** and health-adjacent data, **money and insurance**, **contracts and eligibility** — the reasons *your* org might not put live customer records in a public demo either.

**[PAUSE]**

**[VO]** So what we **did** was run the **same kind of integrations and the same *classes* of platforms** we use in the field — and **inject synthetic data**: made-up people, made-up case IDs, made-up money, made-up documents — a parallel lane that **behaves** like the real path so you can see **the machinery**, not anyone’s private life. Where we can’t spin up a full external sandbox, we **stage** a slice; where we can, we keep it as **faithful to production wiring** as a demo can be.

**[VO]** The honest part I need you to hear: even with all that, this video can only show you **a subset** of what the stack can do — a few **threads** in a much bigger **tapestry**. The real ceiling isn’t a missing license or a missing button; it’s mostly **imagination, scope, and which workflows you want connected next**. If you can describe a business process, we can usually find a way to **route it, automate it, and audit it** — that’s the actual product.

**[VO — optional smile]** People wanted a demo, so we built a path to give you one. *(Worth it.)*

**[PAUSE — half beat]**

**[Optional on-screen / lower-third, 4 seconds]** *Synthetic data · Real integration patterns · Not a client production system*

**[VO]** I’m not here to read a feature list. I’m here to show what a technology company can do when work is **slow, human-heavy, compliance-heavy** — and the answer is to **orchestrate** the real world, not pretend it’s simple.

---

# SECTION 1 — THE FORMAT: BEFORE AND AFTER  (~0:30–0:45)

**[VO]** This video has a simple structure. We’re going to show you what a real organization was doing **before** we built their system, and then what their day-to-day looks like **now**. Before and after.

**[VO]** The data on screen is **injected and fictional** — same integration *shape*, not anyone’s production tenant — but the **story** is real. This is what actually changed.

**[PAUSE]**

**[TRIM NOTE]** If you are tight on time, you can shorten Section 0 and start here — but you lose the explanation for why the data is fake.

---

# SECTION 2 — WHO THEY ARE, AND WHAT LIFE LOOKED LIKE BEFORE  (~2:30–3:30)

**[VO]** Before we get into the product, it’s worth spending a minute on who this organization actually is — because without that context, what you’re about to see won’t make as much sense.

**[VO]** Think of them like a company with an online store. They supply products to clients and need to get those products delivered. But unlike a typical store where the customer pays at checkout, the payment here goes through a special program — a dedicated billing portal — that pays on the client’s behalf. So the company has two core jobs: **get the right product to the right person**, and **submit the right documentation to the program** so the work is funded and on record.

**[VO]** Each client has their own schedule — they’re not just placing one order and done. Deliveries happen multiple times a week, and each client controls what they’re getting on each specific day. That schedule can change, and managing those changes for every client simultaneously is one of the core operational challenges.

**[VO]** On top of that, a client’s account can cover more than just themselves. Clients can have dependants — other people on the same account, like family members. The more dependants on an account, the more items that client is eligible to receive per day. So the company isn’t just tracking one order per client — they’re tracking who’s on each account, what each account is entitled to, and making sure the right quantities go out on the right days.

**[VO]** Delivery works one of two ways. The company either delivers directly using their own team, or they route the order to one of many vendor partners — because different clients want different products, and not everything is stocked in-house. Each vendor specializes in something different, so when an order comes in, the right information has to go to the right vendor. Getting that routing wrong means the wrong product shows up, or nothing shows up at all. Either way, the company is responsible for the outcome and for having proof that the delivery happened.

**[VO]** There’s one more important thing to understand about the people they serve. Many of their clients don’t have reliable access to the internet — or any at all. So the company has to support a phone line as a real, primary channel. Some clients communicate only by phone. Others have access to text messaging but not a web browser. This isn’t a niche edge case — it’s a significant part of their client base, and it shaped everything about how the operation had to be designed.

**[PAUSE]**

**[VO]** Now here’s what running all of that looked like before we built their system.

**[VO]** Client records lived in Excel spreadsheets — multiple spreadsheets, maintained by different people, not always talking to each other. When a client called to make a change, someone updated a sheet. If that person was busy or out that day, the update might not happen at all.

**[VO]** Orders were tracked manually. Delivery labels were created by hand. Figuring out which driver covers which area, in what order, was worked out by a small number of experienced staff — largely from habit and memory. On top of that, any order going to a vendor had to be figured out separately: someone had to determine which vendor carried that product, pull together the right information, and send it to the right place. With multiple vendors in the network, each handling different products and communicating in different ways, that coordination happened mostly through emails, phone calls, and whoever happened to know which vendor to contact. When those people weren’t available, the knowledge gap was real.

**[VO]** Because clients had no way to check on things themselves, the phone line and text channel generated a constant stream of the same questions: “what’s coming this week?”, “can I make a change?”, “did my delivery go out?”. Staff were the system of record, and answering those questions was a significant part of their day.

**[VO]** And then there was billing. For every single client, someone had to piece together the full picture before they could even open the billing portal: pull up the order details, figure out the correct price for each item in that order, and then hunt through hundreds of delivery photos that drivers had submitted — taken at doorsteps across the city — to find the one photo that matched that specific client’s delivery. Only once all of that was assembled could they log into the portal and actually submit the claim. One client at a time. If a submission came back rejected, someone had to catch it, figure out what went wrong, and start the process over. There was no system tracking what had gone out, what had come back, or what was still unresolved. That work alone required a team of roughly 25 people.

**[VO]** The people doing this work were not doing anything wrong — they were doing careful, demanding work. But the system required that level of effort just to keep things moving. There was no path to growth that didn’t mean hiring more people to do the same manual work all over again.

**[PAUSE]**

---

# SECTION 3 — “AFTER” — THE PRODUCT STORY (OPERATIONS)  (~5:00–8:00, adjustable)

*This is your main on-screen tour — the **“after”** to Section 2’s **“before.”** The order below is a good narrative arc; you can compress individual beats.*

**[VO — optional one-liner to reset the room]** So that was the **weight**. Here’s what the **net workflow** looks like **now** — same kind of org, after automation and services from us.

## 3A — A real system of record, not a pile of files  (~45s)

**[VO]** When we step in, the first shift is: **all clients** live in **one** system. Not “an Excel for preferences” and a different truth in email. One place the team can trust when someone asks, “What’s the order, who’s eligible, and what are we even allowed to do?”

**[SCREEN: client list / record-demo-web dashboard]** Pan slowly; **don’t scroll-chase** — this is a calm “we run a real system” shot.

---

## 3B — A portal clients can actually use  (~45s)

**[VO]** The client can log into a **portal** to see the **current order, history, and proof** — the stuff they ask about 40 times a week in a manual world, now visible without a phone call.

**[Optional VO — why it matters]** That matters because a huge slice of “operations cost” is **repetition** — the same status question, the same “did it happen?” — which is a tax on both sides.

**[SCREEN: client profile / order view]** Pick one believable “DEMO” row and **stay on it**; avoid rapid clicking.

---

## 3C — The communication layer: SMS and voice  (~1:00)

**[VO]** We also run **text** and **voice** as real channels. People don’t all live in your portal, but they *do* live in their day — a message thread, a quick call, a “what’s going on with my week?” in plain language.

**[VO]** The point isn’t “we’re trendy.” The point is **intentional deflection of busywork**: answer the predictable things automatically, and keep humans for the *weird* exceptions.

**[SCREEN: `sms-demo` (phone sim)]** Let the scripted conversation play; **narrate over it** lightly, not word-for-word, unless you want a tighter edit.

**[TRIM NOTE]** This beat can be **20 seconds** if you show only 1–2 message pairs.

---

## 3D — Route planning: geography is the service  (~1:00–1:30)

**[VO]** Food is not digital. **Distance is a constraint, not a background image.** The routes page exists because “who goes where, in what order, at what time” is the service quality in motion.

**[VO]** The map helps us be intentional: **even distribution of stops**, not one driver drowning while another idles, and a route that isn’t a spaghetti mess.

**[SCREEN: routes / map view]** Give it **two quiet seconds of silence** so the map reads as a serious tool, not a screenshot.

---

## 3E — “What to pack” and “what to order”  (~1:00)

**[VO]** There is also a downloads side: **what to pack / what to order per client** — the piece that used to be “someone very senior thinking very hard in a spreadsheet for hours.”

**[VO]** When that becomes a generated artifact you can hand to a packing line, you’re not just saving time — you’re **reducing failure modes** where a wrong count becomes a real service failure for a person waiting at a door.

**[SCREEN: vendors / downloads / pack list — whichever exists in the demo]**

---

## 3F — The driver: proof in the field  (~45s–1:00)

**[VO]** The driver’s experience is where “proof of delivery” becomes real. If it’s a hassle, you don’t get consistent proof; if you don’t get consistent proof, the rest of the chain wobbles.

**[VO]** The goal is: **low friction in the moment**, because the hard part is the front porch, the bag, the weather, and the clock.

**[SCREEN: driver / delivery / proof flow — in your app or a stable recording]**

---

## 3G — Vendors, order handoff, and integration  (~1:00–1:15)

**[VO]** And when a vendor is doing the delivery, we need to be able to **send the order outward clearly** and bring **evidence of completion** back into our world — and connect into **how they already work** day to day, including tools they already have.

**[VO example language — not a trademark claim, adapt to your real integration name]** A lot of real-world last-mile work runs through the tools teams already have — the point is: **our job is to be compatible**, not to force a parallel universe.

**[PAUSE]**

**[TRIM NOTE]** If time is short, you can do **3A, 3C, 3D, 3F** as a “greatest hits” and mention **3B and 3E in one sentence** each over B-roll.

---

# SECTION 4 — BILLING: THE NEXT LAYER  (~0:45 intro + on-screen time)

**[VO — bridge]** So far, we’ve been talking about **operating a service in the physical world** — the kind of thing where “software” is easy to under-rate because the bag is real.

**[VO]** The next part is: **funding and documentation have to be reconciled at scale** — and that is where, historically, a growing operation has to add **another** kind of team: the people who live in **submissions, portals, attachments, and the careful differences between one client and another**.

**[VO — problem statement]** It’s not just “invoices.” It’s: **per client**, **per period**, **per approved amount**, **per proof set** — the kind of work that doesn’t get faster just because you hire faster.

**[PAUSE]**

---

# SECTION 5 — BILLING AUTOMATION DEMO: ONE SCREEEN, THEN SCALE  (~1:00–1:30)

**[VO]** I’m going to start the billing demo the way a human would experience it: **on one screen**, one case moving through, because the point is: **it’s not magic — it’s disciplined** — the same way you would do it, just without the 300 clicks a day that destroy morale.

**[VO — “why show one first”]** The reason to show one is trust: I want you to be able to believe there is a **ground truth** — that we’re not generating vibes, we’re executing a workflow you could audit if you had to.

**[SCREEN: billing automation, single run / one queue / one row detail — as your demo supports]**

**[VO — transition, energy up slightly]** And here’s the other half of the story, because the moment you can do this once, the question is never “one.” The question is **fifty**, **two hundred**, **a busy Monday**.

**[VO — scale montage line]** In real life, scale doesn’t look like a bigger person — it looks like **more screens, more workstreams, more exceptions-in-flight** at the same time. So: watch what happens as we **zoom out** to **8**, then **16** — and keep going. This is what “it runs while you do other work” *looks like* in a high-volume world.

**[SCREEN: if you can safely simulate multiple workers / multiple sessions / a grid view — or edit this beat to match what you can truthfully show]**

**[PAUSE — let the scale shot breathe 2 full seconds]**

**[TRIM NOTE]** If you can’t do a literal multi-screen zoom, you can do **verbal** zoom: “eight in parallel, sixteen, more” over a **single** busy board — honesty beats visual tricks.

---

# SECTION 6 — CROWN JEWEL: AUTOMATION, THEN AI, THEN “JUST TELL THE CLOUD”  (~1:00 setup + 4:00–6:00 command section)

**[VO]** For a long time, the “crown jewel” of the operation was: **taking** platforms and workflows that *only* made sense in a browser, that had **no** clean API, and still making the operation **reliable and repeatable** — the kind of automation you don’t get from a single checkbox integration.

**[PAUSE]**

**[VO]** The next level is: **we’re not just scheduling jobs in the abstract**. With AI, we can put a real **conversational command layer** on top — the same underlying tools, the same auditable work — but the on-ramp becomes **normal language** instead of **trained-menu navigation** for a human in a hurry.

**[VO — architecture, plain-English, no vapor]** What you may see in the UI is a chat. But the work is running where work should run: in **infrastructure** that’s already allowed to do the work — a server-side layer that can talk to the automations, trigger them, and report back. I’m not asking you to care about the acronyms; I want you to care that there’s a **separation of concerns** between “what you want” and “how it is executed safely.”

**[If it helps your honest architecture]** If you are showing “MCP,” say it the way you’d say “a standardized way for a model to call the tools we already trust” — and **don’t oversell the brand** over the engineering truth.

**[PAUSE]**

**[Optional — 10 seconds, very calm, before commands]**  
*If you can show a “connected” / “ready” / “server run” state on screen, hold it. Silence is your friend here.*

---

## 6A — The command set: how to *present* it

For each one below, use this **micro-beat** (it keeps the teleprompter from sounding like a list of chores):

1. **Name the pain** in one sentence.
2. **Say the command** clearly (on-screen or VO).
3. **What “good” looks like** in business terms (1 sentence).
4. **[PAUSE] ~1/2 second** (optional).

*Timing targets are for “full read.” If you’re short on time, do **two commands deeply** and summarize the rest as: “and we can do these classes of work at scale.”*

---

## Command 1 — Invoicing a full week, fixed rate, communicate results

**Approx. 0:50–1:00**

**[WHY THIS EXISTS — PAIN, 1 sentence]** Weekly billing is where small mistakes turn into *big* insurance headaches — the wrong week, the wrong per-unit rate, the wrong set of “who even received service.”

**[READ SLOW — THE COMMAND]**

> Create invoices for Monday April 28th through Saturday May 3rd for all clients that received service this week at $175 per service. Email the full invoice summary to the billing team and CC the assigned account manager on each client’s individual invoice.

**[WHAT “GOOD” MEANS, 1 sentence]** A clean, repeatable cut of “what we believe happened this week + what it costs at the rate we set,” with the right comms to the *people who stand behind* each case.

**[ON SCREEN: paste into your assistant, run, show a summary or queue movement — as real as you can safely show]**

---

## Command 2 — Mass correction after a mistake (void + make clients whole + audit trail)

**Approx. 0:50–1:00**

**[WHY — PAIN]** The real world is messy. Sometimes the wrong *codes* go out the door — and “oops” in billing isn’t a vibe; it’s **a compliance event**.

**[COMMAND]**

> Cancel all invoices from last week — we used the wrong service codes. Send each affected client an automated cancellation notice with their credit memo amount, and email me a full summary of everything that was voided.

**[GOOD — 1 sentence]** The story isn’t only “it’s fixed.” The story is: **we can do the scary correction at scale** without hand-building 60 emails in a panic.

**[ON SCREEN: show status changes / a summary / avoid flashing real personal identifiers]**

---

## Command 3 — Cross-check to payroll reality (audit, holds, and humans who care)

**Approx. 0:55–1:10**

**[WHY — PAIN]** The easiest way to lose trust is: bill something that *doesn’t* match the operational record — and timesheets (or the equivalent) are a brutal but honest backstop.

**[COMMAND]**

> Cross-check all April billing records against timesheets, flag every discrepancy, and place any invoice with no timesheet on hold. Email the full audit report to me and Sarah in compliance, and send a separate notice to each client where we found a discrepancy.

**[GOOD — 1 sentence]** You get **human-reviewable** exceptions, not a silent mismatch that becomes a surprise later.

---

## Command 4 — Proof of delivery is not a character trait; it’s a list with aging

**Approx. 0:50–1:00**

**[WHY — PAIN]** Proof is the other half of the story: without it, you are asking everyone to *pretend* the work is defensible. That’s not fair to frontline teams.

**[COMMAND]**

> Show me all clients we're still waiting on proof of delivery for. Automatically send a reminder to anyone outstanding more than 10 days, and email me the full list sorted by how long they've been waiting.

**[GOOD — 1 sentence]** A living queue, not a forgotten folder, with outreach that is **boring, consistent, and time-bounded** — the opposite of “someone was going to do that Monday.”

---

## Command 5 — Vendor follow-up with tone + confirmation loop

**Approx. 0:55–1:05**

**[WHY — PAIN]** When a vendor is in the path, the bottleneck might not be “us.” It can still be **us** to *coordinate* because we’re the accountable layer.

**[COMMAND]**

> Send reminder emails to all vendors with outstanding proof of delivery. Use a firm tone for anyone over 15 days and a standard tone for the rest. CC me on every single email, and send me a delivery confirmation report once all are dispatched.

**[GOOD — 1 sentence]** A controlled communications campaign with a **calibrated tone** and a **closed loop** (you are not left wondering what went out).

---

## Command 6 — Duplicate risk in billing; stop the run before the damage

**Approx. 0:50–1:00**

**[WHY — PAIN]** Billing mistakes aren’t just “a duplicate row.” In many environments, duplicates are how you *lose credibility fast* with payers and with clients.

**[COMMAND]**

> Check if any client was billed for two services in the same period this month. Flag any duplicates, immediately hold those invoices so they can't go out, and email me and the billing director a detailed breakdown for review.

**[GOOD — 1 sentence]** A proactive safety check that treats “stop the bad send” as a first-class outcome.

---

## Command 7 — The “funds in account” gate: bills vs drafts vs manual review

**Approx. 1:00–1:15** *(this one naturally runs a bit longer because it’s two paths)*

**[WHY — PAIN]** Real operations often have a **funding** reality that doesn’t show up in a “generate invoices” button — the world is: “this client is approved, but the money isn’t there yet” — and you can’t just crash through that.

**[COMMAND]**

> Create invoices for Monday April 28th through Saturday May 3rd at $175 per service — but first check that all clients have enough money in their account. If any don't, create draft emails asking them to fund their account and place the drafts in my inbox for review. For the clients that do have enough, run the billing and email me the results.

**[GOOD — 1 sentence]** You can separate “ready to run” from “human decision required,” without pretending finance is a separate universe from service delivery.

**[ON SCREEN: show a split path / drafts vs results — as your demo can honestly support]**

**[TRIM NOTE]** If you are tight on time, you can do **Command 1 + Command 2 + Command 7** as a trio: *happy path*, *catastrophe path*, *money gate path*.

---

# SECTION 7 — CLOSE: WHAT I WANT YOU TO TAKE AWAY  (~0:45–1:00)

**[VO]** I’m not asking you to evaluate a single app screen. I’m asking you to evaluate a pattern: **systems of record, physical logistics, defensible documentation, and automation that can scale without turning the organization into a call center** — and then, on top, a way to *drive* the automation with *plain language* when the world throws you a new Monday.

**[VO — explicit positioning]** The point is to show you what we are as a **technology company**: we build the machinery that makes complex service businesses behave like they have **a hundred more hours a week** — *without* pretending compliance is someone else’s problem.

**[VO — honest close, optional CTA line]** If the problems you have sound like the problems here — **routing, proof, consolidation, and billing reality** — the next step is a conversation that isn’t a demo: it’s about *your* constraints, your payers, your vendors, and your definition of “done right.”

**[PAUSE]**

**[End card, optional, 3 seconds]** *Demo data. Real engineering.*

---

# Appendix A — “Director’s cut” (10–12 minutes)

- **0:00–0:50** — Section 0 (open)  
- **0:50–1:20** — Section 1, shortened (insurance + proof chain only)  
- **1:20–2:00** — Section 2 (25-person “before” — fewer adjectives)  
- **2:00–5:00** — Section 3, scenes **3A, 3C, 3D, 3F, 3G (one line)**  
- **5:00–6:15** — Sections 4–5 (billing + one-screen + scale)  
- **6:15–8:00** — Section 6, **3 commands** + architecture beat  
- **8:00–8:45** — Section 7

---

# Appendix B — Production safety checklist (not VO)

- All data on screen is clearly **synthetic** / demo-labeled — consistent with **injecting** fake records into integration paths, not filming a client’s **live** billing or service tenant.  
- Don’t imply you control or can screen-share **another vendor’s production database** unless that’s literally true for that shot.  
- No real addresses, phone numbers, or payer IDs.  
- If you show email destinations, they are your **internal** demo addresses, not a client.  
- If a command is “real,” say so carefully; if it is **staged** for the recording, you’re not claiming live production.  
- Keep “scale” honest: if multi-screen is simulated, don’t call it a live count.

---

*File created for a teleprompter-style read. Adjust names (Sarah, “assigned account manager,” “billing director”) to match the real people you can legally reference on camera.*