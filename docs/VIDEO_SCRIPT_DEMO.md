# Diet Fantasy — demo video script (short storyboard)

> **For the long "teleprompter" read** (full before/after story, billing commands, timing, and B-roll notes), use **`DEMO_VIDEO_TELEPROMPTER.md`**.

**Audience:** Prospective partners / clients — assume they are not technical and don't know our world yet.  
**Approx. length:** ~8–12 minutes VO at a comfortable pace (trim scenes to fit).  
**Note:** On-screen product is shown with **dummy data** throughout.

### Fast storyboard page (no real API / DB)

For a **smooth recording** without loading full production datasets, use the static storyboard (same repo): start the billing automation UI server, then open **`/video-story/index.html`** (e.g. `http://localhost:3500/video-story/index.html`). Arrow keys or **Next** advance scenes; all client names are synthetic personas.

---

## Cold open (0:00–0:35)

**[VO]**  
Most of the people we'd love to work with want to see *how* we actually work before they commit. The problem is: almost everything we do involves sensitive, private information — who we're serving, where they live, what care they're approved for.

**[VO]**  
We can't put real people's information in a video. So what you're seeing is **the same workflows, the same tools** — just with **made-up names, made-up addresses, and made-up documents**, so nothing real appears on screen.

**[Optional on-screen title]**  
*Confidential by design. This walkthrough uses dummy data.*

---

## The "before" — what life looked like (0:35–1:45)

**[VO]**  
Before we get into the product, it's worth spending a minute on *what we replaced* — because otherwise the software just looks like software.

**[VO]**  
We work with organizations that supply food to people who need it — often as part of a medical care plan. And for a long time, running that kind of program looked something like this:

**[VO]**  
Client information lived in spreadsheets. Multiple spreadsheets. Preferences changed on a phone call that the spreadsheet never heard about. Staff spent their days answering the same questions — "what's coming Tuesday?", "can we change this?", "what actually happened last week?" — because there was no single place to look.

**[VO]**  
Route planning was something a few experienced people held in their heads. Getting food to the right door, in the right order, without burning out drivers — that was a puzzle solved fresh every week.

**[VO]**  
And billing — submitting claims to insurance or a payer for the work your team just did — was its own separate mountain. Someone would sit down, open the payer's website, and go case by case, screen by screen, re-entering information that already existed somewhere else. When a claim was rejected, someone had to chase it. When proof of delivery was missing, someone had to find it. This kind of work supported a team of around 25 people whose main job was to hold the whole thing together through sheer effort.

**[VO]**  
That's not a criticism of the people — they were doing hard work, carefully. But it meant the program could only grow as fast as you could hire.

**[PAUSE]**

---

## What you're about to see (1:45–2:15)

**[VO]**  
What you're about to see is what that same kind of program looks like after we've built the system around it — one place for everything, with the repetitive parts handled automatically, so the people can focus on the parts that actually need a human.

---

## Scene 1 — One place for every client (2:15–3:15)

**[VO]**  
The first change is the simplest: **everything lives in one place**. One record per client — not scattered across inboxes, tabs, and "the spreadsheet Sarah keeps updated."

**[VO, as you pan the UI]**  
When someone asks "what's going on with this client?" — the answer is here. Not a phone call away, not buried in a thread. Just here.

**[Optional lower-third]**  
*One source of truth → fewer mistakes → faster service.*

---

## Scene 2 — Clients can update their own information (3:15–4:00)

**[VO]**  
In the old world, if a client's email address changed, a staff member had to update it — and until they did, important messages went to the wrong place.

**[VO]**  
Now, **clients can update their own details** themselves — with the right guardrails in place. It sounds small. But "wrong email" is how a family misses a delivery notice, or billing goes to the wrong contact, or a time-sensitive window gets missed.

---

## Scene 3 — Getting food to the right door (4:00–5:00)

**[VO]**  
When you're moving food to real people, the map *is* the job. It's not a nice-to-have — it's the difference between a driver finishing at a reasonable hour or spending their afternoon backtracking.

**[VO]**  
This view gives us **planned routes for drivers** — who goes where, in what order — so the work is distributed fairly and the food arrives on time.

**[Optional lower-third]**  
*Route planning = predictable operations.*

---

## Scene 4 — When someone else is doing the delivery (5:00–6:00)

**[VO]**  
Sometimes we're not the ones making the delivery — a vendor partner does. But we're still responsible for the outcome.

**[VO]**  
So we show how we **send the work out** to that vendor and, just as importantly, how **proof of delivery comes back to us** — so there's one clear record of what happened and when. Not "we think it was delivered." We know it was.

**[VO]**  
That difference matters a lot when you're dealing with insurance and compliance.

---

## Scene 5 — The right access for the right person (6:00–6:45)

**[VO]**  
Different people on a team need to see different things. A driver needs to see stops — not billing records. A billing coordinator needs invoice details — not route planning.

**[VO]**  
The system is set up so **each person sees exactly what their role needs** — nothing more, nothing less. That protects clients and keeps the work clean.

**[Optional on-screen title]**  
*The right access, for the right person.*

---

## Scene 6 — Billing: the part that used to be the hardest (6:45–8:30)

**[VO]**  
Now for the thing that was the biggest source of pain in the "before": getting claims submitted.

**[VO]**  
Payer websites — the systems where you submit claims for reimbursement — are not built to be easy. They weren't designed for bulk work. So teams end up going screen by screen, client by client, doing the same clicks every single time.

**[VO]**  
What we're showing here is the **billing automation** — a system that moves through that process the same way a careful human would, but without the 300 clicks a day. It knows each client's dates, their approved amounts, their specific details — and it works through the queue accordingly.

**[VO]**  
Behind the scenes, it's navigating the payer's system, reading what's approved, submitting what's ready, and keeping track of what's done — while everything on screen stays anonymized so we can actually show you.

**[Optional lower-third]**  
*Careful, repeatable — just without the manual grind.*

---

## Scene 7 — Talking to the system in plain language (8:30–10:00)

**[VO, transition]**  
Everything you've seen so far, a trained person can do inside the product. But here's something else: you can also just **ask it in plain English** — and it carries out the real work.

**[VO]**  
You don't need to understand how it's built. What matters is what it feels like: you say what you need, and it does it — not by guessing, but by running the same actual processes you just saw.

**[VO — as you show the chat interface]**  
For example: *"Run billing for this week."*  
The system starts the billing process — the same one we just walked through — because it's calling real tools, not improvising.

**[VO — second example]**  
Or: *"Which invoices were rejected?"*  
It checks, it finds the answer, and it tells you — tied to what actually happened, not a rough guess.

**[VO]**  
Run a billing batch. Check for rejections. Pull proof of delivery. See the queue. These are things your team already does — and now they can be done faster, with a full record of what ran and when.

**[VO]**  
The key thing here is that it's not an AI roaming freely around your data. It's calling **specific, defined actions** — like buttons you can see and trust, but accessed through conversation.

**[Optional lower-third]**  
*Ask in plain language → real action → accountable result.*

---

## Closing (10:00–10:45)

**[VO]**  
If you're evaluating us, what we want you to take away isn't a list of features — it's a pattern. The world we work in is physical, human, and compliance-heavy. Food goes to real doors. Claims go to real payers. Vendors are real partners with their own ways of working.

**[VO]**  
We built for that world — not the clean, frictionless version of it. And we built a dummy-data demo specifically because we take confidentiality seriously enough to not cut corners just to make ourselves look good.

**[VO, CTA]**  
If the problems you heard here sound like the problems you're dealing with — the next conversation should be about *your* situation: your team, your vendors, your payers, and what "done right" looks like for you.

**[End card]**  
*Diet Fantasy — coordinated care, delivered.*

---

## Production notes (not VO)

- **Scene order on camera:** cold open → before story → what you'll see → dashboard → client self-edit → map/routes → vendor handoff + proof → roles/permissions → billing automation → conversational control (Scene 7) → close.  
- **Scene 7** should be shot as **live product**: show the chat prompt → visible system response → brief cut to billing queue or status as proof (still dummy data).  
- **Optional legal comfort line** (VO over sensitive montage): *All identifiers and documents shown here are fictional.*
