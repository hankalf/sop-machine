# SOP Machine

One place to write, design, approve and export **every warehouse SOP**, from WMS screens to trailer and dock work, in a single consistent format.

- **Unified SOP format**: Purpose, Scope, Roles, Safety & PPE, Equipment/Systems, numbered Procedure (with phase sections), Notes, Reference media, Revision history and Approvals.
- **Template Designer** with a live, paginated preview: colors, fonts, cover page, header/footer, step layout, image size, section order and names, watermark, paper size. Assign templates per category.
- **Screenshots, photos and videos** on any step. Paste screenshots with Ctrl+V, drag and drop, mark them up (boxes, arrows, numbers, text, **redact**).
- **AI from a screen recording**: upload a recording of a computer system and get a draft SOP with a screenshot for each step and the button to click highlighted. Phone videos of floor tasks (trailers, docks, forklifts) work too.
- **Import existing SOPs**: drop in your old PDF or Word SOPs (up to 25 at a time). Each one is rebuilt into the unified format and your template, keeping its steps, images and original numbers.
- **PDF export** (default) and **Word (.docx)** export, with QR codes that link printed copies to the latest version and to videos.
- **Document control**: draft → review → approved → archived, version numbers, revision history, scheduled review dates, "uncontrolled when printed" footer, DRAFT/OBSOLETE watermarks. Viewers only ever see the last approved version.
- **Admin panel**: logo and branding, templates, export options, workflow and numbering, categories, users and roles, languages, email, AI settings, storage use and one-click backup.

**On the floor**

- **Training sign-off**: associates confirm "I have read and understood" each approved revision, in the app or by scanning a QR code. Supervisors can record a whole toolbox talk at once. The **Training** page shows who is current on what and exports the matrix for audits. A new revision asks everyone to sign again.
- **Stations & QR placards**: create a station per dock door, workstation or machine, pick its SOPs, and print a placard (Letter, half-letter or 4×6). Scanning always opens the current approved version, with or without an account.
- **Checklist mode**: any SOP can be filled in as a checklist on a phone: pass / fail / N/A per step, required notes on failures, photos, record fields (trailer #, door, seal #) and a typed signature. Every run is saved under **Checklist records** with CSV and PDF export.
- **Bilingual SOPs**: one-click AI translation into 18 languages, a side-by-side review screen for a bilingual team member, and three ways to show it everywhere (digital view, PDF, Word, binders, checklists): English, translated, or bilingual with the translation under the English.
- **Binders**: export a whole category (or everything) as one PDF with a cover and a contents page with real page numbers.
- **Email**: review requests to admins, approval notices to owners, "please re-sign" to people who signed an older revision, and reminders before an SOP's review date.
- **Narrated recordings**: talk while you record. Spoken explanations and warnings are transcribed and worked into the steps.
- **Object storage**: keep photos and videos in a Railway Bucket (or any S3-compatible storage) instead of the volume, with one-click migration of existing files.

---

## Deploy on Railway

Everything (app, database and uploaded files) runs in **one Railway service with one volume**.

1. **Push this repo to GitHub**, then in Railway: **New Project → Deploy from GitHub repo** and pick it. Railway finds the `Dockerfile` and `railway.json` automatically.
2. **Add a volume** (this is where SOPs, images and videos are stored): open the service → **Settings → Volumes → Add volume** with mount path **`/data`**.
   With the CLI instead: `railway volume add --mount-path /data`.
3. **Add variables** (service → **Variables**):

   | Variable | Required | What it does |
   | --- | --- | --- |
   | `ADMIN_EMAIL` | yes | Email for the first admin account |
   | `ADMIN_PASSWORD` | yes | Password for the first admin account (change it after first login) |
   | `SESSION_SECRET` | yes | Long random string that signs logins, e.g. from `openssl rand -hex 32` |
   | `ANTHROPIC_API_KEY` | for AI | Turns on *Generate with AI* and *Import existing SOPs*. Create one at console.anthropic.com |
   | `APP_URL` | optional | Your public URL if you use a custom domain. Otherwise the Railway domain is used for QR codes |
   | `MAX_UPLOAD_MB` | optional | Largest upload, default `1024` |

   Optional add-ons (each feature stays off until its variables are set):

   | Feature | Variables |
   | --- | --- |
   | **Email** (reminders, approvals) | `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (e.g. `SOPs <sops@yourcompany.com>`). Works with Microsoft 365, Google Workspace, SendGrid, Mailgun, SES… |
   | **Videos in a bucket** | `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (default `auto`). Add a Railway Bucket to the project and copy its credentials, then use *Admin → Storage & backup → Move files to the bucket*. Set `S3_FORCE_PATH_STYLE=true` for MinIO-style servers |
   | **Narrated recordings** | `GROQ_API_KEY` (free tier available) or `OPENAI_API_KEY`. For a self-hosted Whisper server set `TRANSCRIBE_BASE_URL` (and `TRANSCRIBE_MODEL`) |

4. **Generate a domain**: service → **Settings → Networking → Generate Domain**.
5. Open the URL and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**Sizing:** PDF export runs a headless Chromium. Give the service at least **1 GB RAM**. Videos use the most storage. Watch **Admin → Storage & backup** and grow the volume when needed.

**Backups:** Admin → Storage & backup → *Download full backup* zips the database and every uploaded file. Railway can also take scheduled volume backups.

> Keep the service at **1 replica**. The database is SQLite on the volume, which a single instance owns.

### Is the AI required? Is there a free option?

No part of the app depends on AI except the features that write for you. Without an API key you can still write SOPs by hand, design templates, attach photos and videos, export PDF and Word, run approvals, sign-offs, stations, checklists, binders and email.

These need `ANTHROPIC_API_KEY`: **generate from a recording**, **generate from notes**, **import existing SOPs**, and **translate**. It is pay-as-you-go with no subscription. Estimated from list prices (not yet measured on real use): roughly 50 cents for a 5-minute screen recording and 10 to 30 cents for a translation or an import.

There is no free, key-less service that reads screen recordings at a usable quality, so none is built in. A self-hosted open model would need a GPU server that costs more per month than the API does for normal use.

### First-time setup checklist
1. **Admin → Branding**: upload your logo, set the company name.
2. **Admin → Templates**: open *Standard SOP* in the designer and adjust colors, fonts and the cover. Three starter templates are included (Standard, Computer Systems, Floor & Trailer Quick Guide).
3. **Admin → Categories**: review the warehouse categories (Systems, Trailer & Dock, Receiving, Shipping, Inventory, Equipment, Safety) and the template each uses.
4. **Admin → Export & workflow**: default format (PDF), file name pattern, approvals and review interval, SOP numbering (`WH-TRL-001`).
5. **Admin → Users**: add editors (write SOPs) and viewers (floor associates who read and print).
6. **Generate & import → Import existing SOPs**: bring in your current SOP library.
7. **Admin → Languages**: choose the languages your team reads (Spanish is on by default).
8. **Stations & QR**: create a station per dock door or workstation and print its placard.
9. **Admin → Email**: send a test email once the SMTP variables are set.

---

## Using it

| Task | Where |
| --- | --- |
| Write an SOP by hand | Library → **New SOP** |
| Turn a screen recording into an SOP | **Generate & import → From a recording** |
| Convert old PDF/Word SOPs | **Generate & import → Import existing SOPs** |
| Draft from rough notes | **Generate & import → From notes** |
| Change how exported SOPs look | **Admin → Templates → Design** |
| Approve and publish | Open the SOP → **Approve and publish** (admins) |
| Translate an SOP | Open the SOP → **Translations → Translate**, then **Review** |
| See who is trained | **Training** (export CSV for audits) |
| Post SOPs at a dock door | **Stations & QR** → New station → **Placard** |
| Turn an SOP into a checklist | Edit the SOP → **Checklist mode** |
| See completed checklists | **Checklist records** |
| Print a binder | Library → **Export binder** |
| Print or send | Open the SOP → **Export PDF** / **Export Word** |

**Recording tips:** on Windows use `Win + Alt + R` (Game Bar) or Snipping Tool → Record; on a Mac use `⌘ + Shift + 5`. Go slowly and pause about a second after each click. Use test data where you can, and black out anything sensitive afterwards with **Redact**.

**Roles:** *Admin* (everything), *Editor* (create/edit/generate, submit for review), *Viewer* (read and export approved SOPs).

---

## Local development

Requirements: Node 22+, `ffmpeg`, `pdfimages` (poppler-utils) and Chromium (or set `CHROMIUM_PATH`).

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

The web app runs at http://localhost:5173 (API on :3001). Data goes to `./data`.

```bash
npm run typecheck
```

```bash
npm run build && npm start
```

### How it works

```
client/   React + Vite + Tailwind web app (library, editor, viewer, template designer, admin)
server/   Express API, SQLite (better-sqlite3), media storage, renderers, AI pipeline
shared/   Types and defaults used by both
```

- **One renderer for everything:** each SOP is rendered to HTML from its template. The digital view shows that HTML directly. Print preview and PDF export paginate it with **Paged.js** (running headers, page X of Y, a table of contents with page numbers, cover pages), and headless Chromium prints it. So the designer preview matches the PDF exactly.
- **Word export** is built natively with `docx` (real headings, tables, numbered lists, images, header/footer with page numbers).
- **Screen recordings:** ffmpeg samples the video, picks the settled screen right before each significant change, and sends those frames to Claude, which returns structured steps. Each step gets its frame as the screenshot, with the click target outlined.
- **Imports:** text and embedded images are extracted (mammoth for Word, `pdfimages` for PDF; the PDF itself is also sent so layout and scanned pages are understood). Logos repeated on every page are filtered out. Claude maps the content to the unified structure and places each image on the right step.
- **Translations** are stored per language and tied to the exact English text they were made from. Floor staff only ever see a translation that matches the approved text; editors see when the English has moved on and can re-translate or correct it.
- **Stations** have an unguessable link behind the QR code. An open station exposes only its own approved SOPs and their media; the code can be replaced if a placard goes missing.
- **Checklist runs** keep a snapshot of the SOP revision they were run against, so a record always shows the steps as they were on that day.
- AI calls use **Claude Opus 5.5** with structured outputs and automatic server-side fallback; the model and effort can be changed under Admin → AI.

---

## Roadmap: suggested improvements

Ideas for later, roughly in order of value:

1. **Corrective actions**: turn a failed checklist item into an assigned task with a due date, and email the supervisor the moment something fails.
2. **Side-by-side revision compare**: highlight what changed between approved versions, and show that summary when people re-sign.
3. **Single sign-on** (Microsoft 365 / Google) so associates don't need separate passwords.
4. **Offline floor mode**: an installable app that keeps approved SOPs and checklists working in trailers and cold storage with poor Wi-Fi.
5. **Quiz before sign-off**: two or three questions per SOP so sign-off proves understanding, not just a tap.
6. **Comments on drafts**: reviewers leave comments on a specific step instead of editing it.
7. **Scheduled checklists**: "forklift pre-shift inspection, every shift, every truck" with a dashboard of what was missed.
8. **Dashboards**: sign-off rates by team, most-failed checklist items, SOPs nobody has opened.
