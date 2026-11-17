# SOP Machine

One place to write, design, approve and export **every warehouse SOP**, from WMS screens to trailer and dock work, in a single consistent format.

- **Unified SOP format**: Purpose, Scope, Roles, Safety & PPE, Equipment/Systems, numbered Procedure (with phase sections), Notes, Reference media, Revision history and Approvals.
- **Template Designer** with a live, paginated preview: colors, fonts, cover page, header/footer, step layout, image size, section order and names, watermark, paper size. Assign templates per category.
- **Screenshots, photos and videos** on any step. Paste screenshots with Ctrl+V, drag and drop, mark them up (boxes, arrows, numbers, text, **redact**).
- **AI from a screen recording**: upload a recording of a computer system and get a draft SOP with a screenshot for each step and the button to click highlighted. Phone videos of floor tasks (trailers, docks, forklifts) work too.
- **Import existing SOPs**: drop in your old PDF or Word SOPs (up to 25 at a time). Each one is rebuilt into the unified format and your template, keeping its steps, images and original numbers.
- **PDF export** (default) and **Word (.docx)** export, with QR codes that link printed copies to the latest version and to videos.
- **Document control**: draft → review → approved → archived, version numbers, revision history, scheduled review dates, "uncontrolled when printed" footer, DRAFT/OBSOLETE watermarks. Viewers only ever see the last approved version.
- **Admin panel**: logo and branding, templates, export options, workflow and numbering, categories, users and roles, AI settings, storage use and one-click backup.

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

4. **Generate a domain**: service → **Settings → Networking → Generate Domain**.
5. Open the URL and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

**Sizing:** PDF export runs a headless Chromium. Give the service at least **1 GB RAM**. Videos use the most storage. Watch **Admin → Storage & backup** and grow the volume when needed.

**Backups:** Admin → Storage & backup → *Download full backup* zips the database and every uploaded file. Railway can also take scheduled volume backups.

> Keep the service at **1 replica**. The database is SQLite on the volume, which a single instance owns.

### First-time setup checklist
1. **Admin → Branding**: upload your logo, set the company name.
2. **Admin → Templates**: open *Standard SOP* in the designer and adjust colors, fonts and the cover. Three starter templates are included (Standard, Computer Systems, Floor & Trailer Quick Guide).
3. **Admin → Categories**: review the warehouse categories (Systems, Trailer & Dock, Receiving, Shipping, Inventory, Equipment, Safety) and the template each uses.
4. **Admin → Export & workflow**: default format (PDF), file name pattern, approvals and review interval, SOP numbering (`WH-TRL-001`).
5. **Admin → Users**: add editors (write SOPs) and viewers (floor associates who read and print).
6. **Generate & import → Import existing SOPs**: bring in your current SOP library.

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
- AI calls use **Claude Opus 5.5** with structured outputs and automatic server-side fallback; the model and effort can be changed under Admin → AI.

---

## Roadmap: suggested improvements

Ideas that would make this more useful on the floor, roughly in order of value:

1. **Training sign-off & acknowledgments**: associates confirm "I have read and understood" each new revision (QR scan at the station); supervisors see who is trained on what. This is often an audit requirement.
2. **Station QR placards**: print a laminated card per workstation/dock door that always opens the current SOP.
3. **Bilingual SOPs**: one-click AI translation (e.g. Spanish) kept side by side with the English version, exported as a dual-language PDF.
4. **Narrated recordings**: transcribe the audio track so spoken explanations ("always check the seal number here") become step text and callouts.
5. **SOP binders**: export a whole category as one PDF with a master table of contents for the physical binder at the dock.
6. **Review reminders by email**: notify owners 30 days before an SOP's review date, and approvers when something is submitted.
7. **Side-by-side revision compare**: highlight what changed between approved versions.
8. **Object storage for videos**: move media to S3-compatible storage (e.g. a Railway bucket) when the volume gets large; keep SQLite or move to Postgres for multiple instances.
9. **Single sign-on** (Microsoft 365 / Google) so associates don't need separate passwords.
10. **Offline floor mode**: installable app (PWA) that caches approved SOPs for areas with poor Wi-Fi (trailers, cold storage).
11. **Step-level checklists**: turn an SOP into a fillable checklist (e.g. trailer pre-load inspection) that records who completed it and when.
12. **Comments on drafts**: reviewers leave comments on a specific step instead of editing it.
