# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline-HTML comment-server with a static frontend (DaisyUI + Tailwind + Alpine.js via CDN) featuring dark mode, kanban board, overview page, epic switcher, threaded comments, and improved mocks gallery.

**Architecture:** Static HTML files in `scripts/ui/` served by comment-server.js which becomes API-focused. All pages load data via fetch from JSON endpoints. Alpine.js handles client-side state (filters, drawers, tabs). No build step — all deps via CDN.

**Tech Stack:** DaisyUI 4.x, Tailwind CSS (CDN play), Alpine.js 3.x, Node.js HTTP server (existing)

**Security note:** All data displayed in the UI originates from local JSON files (state.json, epic.json, repos.json) written by the kryptonite orchestrator — not untrusted user input. Alpine.js uses `x-text` for rendering (which escapes HTML by default). The comment system stores plain text — no HTML rendering in comment bodies.

---

## File Structure

```
skills/kryptonite/scripts/
├── comment-server.js          (refactored: API endpoints + static file serving)
└── ui/
    ├── index.html             (Overview page)
    ├── stories.html           (Kanban board + drawer)
    ├── mocks.html             (Gallery + Compare tabs)
    ├── dashboard.html         (Execution tracking)
    └── assets/
        ├── style.css          (Custom overrides)
        ├── app.js             (Shared: nav loader, drawer, comments, epic switcher)
        └── nav.html           (Nav bar partial)
```

Key decision: shared components (nav, drawer, comments) live in `app.js` as Alpine.js components and HTML partials — not separate page files. This keeps things simple and avoids a module system.

---

### Task 1: Create ui/ folder scaffold with shared assets

**Files:**
- Create: `skills/kryptonite/scripts/ui/assets/style.css`
- Create: `skills/kryptonite/scripts/ui/assets/app.js`
- Create: `skills/kryptonite/scripts/ui/assets/nav.html`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p skills/kryptonite/scripts/ui/assets
```

- [ ] **Step 2: Create style.css with dark theme overrides**

```css
/* Custom overrides on top of DaisyUI dark theme */
:root {
  --page-bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --text-primary: #e2e8f0;
  --text-muted: #64748b;
  --accent: #10b981;
}

body {
  background: var(--page-bg);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  margin: 0;
  padding-top: 56px; /* nav height */
}

/* Kanban column tints */
.col-pending { background: #1e293b; border: 1px solid var(--border); }
.col-in-progress { background: #1c1917; border: 1px solid #451a03; }
.col-qa { background: #0c1929; border: 1px solid #1e3a5f; }
.col-code-review { background: #1a0f2e; border: 1px solid #3b0764; }
.col-done { background: #052e16; border: 1px solid #14532d; }

/* Story cards */
.story-card {
  background: var(--page-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.story-card:hover {
  border-color: var(--accent);
}

/* Drawer */
.drawer-panel {
  position: fixed;
  top: 56px;
  right: 0;
  bottom: 0;
  width: 440px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  transform: translateX(100%);
  transition: transform 0.2s ease;
  z-index: 50;
}
.drawer-panel.open {
  transform: translateX(0);
}
.drawer-backdrop {
  position: fixed;
  inset: 0;
  top: 56px;
  background: rgba(0,0,0,0.4);
  z-index: 40;
}

/* Filter pills */
.filter-pill {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 12px;
  cursor: pointer;
  user-select: none;
}

/* Badge colors */
.badge-critical { background: #450a0a; color: #f87171; }
.badge-high { background: #451a03; color: #fbbf24; }
.badge-medium { background: #451a03; color: #fbbf24; }
.badge-low { background: #052e16; color: #4ade80; }
.badge-persona { background: #2e1065; color: #a78bfa; }
.badge-repo { background: #1e3a5f; color: #60a5fa; }
.badge-done { background: #14532d; color: #4ade80; }
.badge-mock { background: #1e3a5f; color: #60a5fa; }
```

- [ ] **Step 3: Create app.js with Alpine.js shared state and utilities**

```javascript
// Shared utilities and Alpine.js components for kryptonite UI
const API_BASE = '';

async function fetchJSON(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

// Load nav partial into page
async function loadNav() {
  const navEl = document.getElementById('nav-container');
  if (!navEl) return;
  const res = await fetch('/ui/assets/nav.html');
  const text = await res.text();
  navEl.textContent = '';
  const template = document.createElement('template');
  template.innerHTML = text;
  navEl.appendChild(template.content.cloneNode(true));
}

// Alpine store: shared app state
document.addEventListener('alpine:init', () => {
  Alpine.store('app', {
    epic: null,
    state: null,
    repos: null,
    epics: [],
    currentEpic: null,
    drawerStory: null,
    drawerOpen: false,

    async load() {
      const [epic, state, repos, epics] = await Promise.all([
        fetchJSON('/api/epic'),
        fetchJSON('/api/state'),
        fetchJSON('/api/repos'),
        fetchJSON('/api/epics'),
      ]);
      this.epic = epic;
      this.state = state;
      this.repos = repos;
      this.epics = epics;
      this.currentEpic = epics.find(e => e.current) || epics[0];
    },

    openDrawer(storyId) {
      this.drawerStory = this.state?.stories?.find(s => s.id === storyId) || null;
      this.drawerOpen = true;
    },

    closeDrawer() {
      this.drawerOpen = false;
      this.drawerStory = null;
    },

    async switchEpic(slug) {
      await fetch('/api/epics/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug })
      });
      location.reload();
    },

    formatStatement(story) {
      if (!story?.statement) return '';
      const s = story.statement;
      return 'As a ' + s.as_a + ', I want to ' + s.i_want + ' so that ' + s.so_that;
    },

    storyTitle(story) {
      return story?.statement?.i_want || story?.id || '';
    }
  });
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadNav();
});
```

- [ ] **Step 4: Create nav.html partial**

The nav bar with epic switcher dropdown, page tabs, phase badge, and progress stats. Uses Alpine.js for interactivity (dropdown toggle, active tab highlighting, data binding to store).

- [ ] **Step 5: Commit scaffold**

```bash
git add skills/kryptonite/scripts/ui/
git commit -m "feat(ui): scaffold ui/ folder with shared assets, nav, and Alpine store"
```

---

### Task 2: Refactor comment-server.js to serve static UI + API

**Files:**
- Modify: `skills/kryptonite/scripts/comment-server.js`

- [ ] **Step 1: Make statePath, specPath, planPath mutable for epic switching**

Change `const` declarations to `let` for the three path variables parsed from args.

- [ ] **Step 2: Add static file serving for ui/ directory**

Add route handler (after CORS preflight, before existing routes) that matches `/ui/*` paths, reads from the ui/ directory, and serves with correct Content-Type headers.

- [ ] **Step 3: Add GET /api/epic endpoint**

Read epic.json from the same directory as state.json, return as JSON.

- [ ] **Step 4: Add GET /api/repos endpoint**

Read repos.json from the project directory (parent of epic directory), normalize the `{ repos: [...] }` wrapper vs plain array format, return as JSON array.

- [ ] **Step 5: Add GET /api/epics endpoint**

Scan the project directory for all subdirectories that contain epic.json. For each, load epic.json and state.json to build metadata (slug, name, status, phase, story_count, progress, current flag).

- [ ] **Step 6: Add POST /api/epics/switch endpoint**

Accept `{ slug }` body, update `statePath`, `specPath`, and `planPath` to point to the new epic directory. Verify state.json exists before switching.

- [ ] **Step 7: Update comments system for story comments and resolve toggle**

Migrate comments storage to `{ spec_comments: [], story_comments: [] }` format. Handle old array format on load (treat as spec_comments). Add `story_id`, `parent_id`, and `resolved` fields. Update GET to filter by `?story_id=` or `?section=` query params. Update PUT to support toggling `resolved`.

- [ ] **Step 8: Add UI page routes**

Map `/` to `ui/index.html`, `/stories` to `ui/stories.html`, `/mocks` to `ui/mocks.html`, `/dashboard` to `ui/dashboard.html`. Keep `/spec` and `/plan` as server-injected external HTML.

- [ ] **Step 9: Commit server refactor**

```bash
git add skills/kryptonite/scripts/comment-server.js
git commit -m "feat(ui): refactor comment-server to API-first with static serving and epic switcher"
```

---

### Task 3: Build Overview page (index.html)

**Files:**
- Create: `skills/kryptonite/scripts/ui/index.html`

- [ ] **Step 1: Create the Overview page**

Full HTML page with CDN imports (DaisyUI, Tailwind, Alpine.js), app.js and style.css. Page content uses Alpine.js `x-text` bindings (auto-escaped, no XSS) to render:
- Header with epic name, description, phase badge
- Progress bar and stats grid (total, done, in progress, waves)
- Two-column layout: Parties + Repos (left), Technical Context + Waves (right)
- Epic meta footer (version, created date, mock count)

All data rendered from `$store.app.epic`, `$store.app.state`, and `$store.app.repos`.

- [ ] **Step 2: Test by starting server and loading the page**

```bash
node skills/kryptonite/scripts/comment-server.js --state-path skills/kryptonite/data/7147a468863c/readiness-mvp/state.json --spec-path skills/kryptonite/data/7147a468863c/readiness-mvp/spec.html
```

Open http://localhost:3847 — verify Overview renders with real data.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/ui/index.html
git commit -m "feat(ui): add Overview page with epic summary, parties, repos, waves"
```

---

### Task 4: Build Stories page (kanban board + drawer)

**Files:**
- Create: `skills/kryptonite/scripts/ui/stories.html`

- [ ] **Step 1: Create the Stories page**

Full HTML page with:
- **Filter bar**: DaisyUI select elements bound to Alpine.js state for repo, persona, priority, wave. Checkbox for "Has Mock". Text input for search.
- **Kanban board**: 5 columns (Pending, In Progress, QA/Review, Code Review, Done) using CSS grid. Each column maps to status values. Stories rendered as cards via `x-for` with filter function applied.
- **Story cards**: Show ID+repo, title (i_want), priority/persona/mock badges, status context line. Click triggers `$store.app.openDrawer(story.id)`.
- **Drawer**: Fixed panel (440px) slides from right. Shows: statement, meta grid (2x2), dependencies, acceptance criteria, DOD checklist with method badges, mock preview link, comments thread with add/resolve, execution info.
- **Comments in drawer**: Alpine.js component that fetches `/api/comments?story_id=X`, supports adding via POST, resolving via PUT. Uses `x-text` for all content rendering.

Filter logic: Alpine.js function `filteredStories(statuses)` applies all active filters client-side.

- [ ] **Step 2: Test the Stories page**

Navigate to http://localhost:3847/stories. Verify:
- Kanban columns render with stories from state.json
- Filters work (select a repo, cards filter instantly)
- Click a card, drawer slides in with full detail
- Comments can be added and resolved

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/ui/stories.html
git commit -m "feat(ui): add Stories kanban board with filters, drawer, and comments"
```

---

### Task 5: Build Mocks page (gallery + compare)

**Files:**
- Create: `skills/kryptonite/scripts/ui/mocks.html`

- [ ] **Step 1: Create the Mocks page**

Full HTML page with:
- **Tab toggle**: "Gallery" and "Compare (N pending)" using DaisyUI tab styling with Alpine.js `x-show`.
- **Gallery tab**: Two sections — "Foundational Mocks" (filtered by `mock_phase === 'foundational'`) and "Detail Mocks" (filtered by `mock_phase === 'detail'`). Cards in grid: thumbnail area, story ID, status badge, title. Click opens mock HTML in new tab.
- **Compare tab**: Shows one pending (unapproved) mock story at a time. Three option frames side-by-side rendered as iframes at 50% scale (`/mocks/{id}-option-{a|b|c}.html`). Click to select (green border + glow). Prev/Next navigation. Keyboard shortcuts (1/2/3, arrows). "Confirm" button POSTs selections to `/api/selections`.

Selections persisted via API (no longer in-memory only).

- [ ] **Step 2: Test the Mocks page**

Navigate to http://localhost:3847/mocks. Verify gallery renders grouped by phase.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/ui/mocks.html
git commit -m "feat(ui): add Mocks page with gallery (foundational/detail) and compare tabs"
```

---

### Task 6: Build Dashboard page

**Files:**
- Create: `skills/kryptonite/scripts/ui/dashboard.html`

- [ ] **Step 1: Create the Dashboard page**

Full HTML page with:
- Wave-by-wave sections: each wave gets a card with name, status badge, progress bar, and story table.
- Story table columns: ID, Story (title), Status (badge), Priority, DOD (passed/total), Commit (SHA), Agent.
- Auto-refresh: `setInterval` fetches `/api/state` every 10s and updates Alpine store.

- [ ] **Step 2: Test the Dashboard**

Navigate to http://localhost:3847/dashboard. Verify wave progress bars and story tables render.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/ui/dashboard.html
git commit -m "feat(ui): add Dashboard page with wave progress and story tables"
```

---

### Task 7: Update Spec/Plan injection for dark theme

**Files:**
- Modify: `skills/kryptonite/scripts/comment-server.js` (the `injectUI` function)

- [ ] **Step 1: Update injectUI to apply dark theme and new nav**

Replace the existing injection with one that:
- Injects dark theme CSS overrides into `<head>` (dark backgrounds, light text, dark borders)
- Loads Alpine.js, app.js, and style.css
- Inserts nav container div at start of `<body>` with `x-init` to load the store and nav

Keep the spec/plan comment system working (section-level badges).

- [ ] **Step 2: Test spec and plan pages**

Navigate to /spec and /plan. Verify dark theme applies, nav bar loads, comment system works.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/comment-server.js
git commit -m "feat(ui): apply dark theme and new nav to spec/plan page injection"
```

---

### Task 8: Clean up legacy inline HTML generators

**Files:**
- Modify: `skills/kryptonite/scripts/comment-server.js`

- [ ] **Step 1: Remove old inline HTML generation functions**

Remove: `dashboardHTML()`, `mocksGalleryHTML()`, `compareHTML()`, old `NAV_BAR` constant, old `BRAND` constants, old `COMMENT_CLIENT_SCRIPT`, old `NAV_COMPAT_STYLE`.

Keep: `injectUI()`, `getState()`, all API handlers, mock file serving, visual companion routes.

- [ ] **Step 2: Remove old route handlers for /dashboard, /mocks, /compare that called removed functions**

These routes are now handled by the UI page router added in Task 2.

- [ ] **Step 3: Verify all pages still work**

Start server, visit all 6 routes, confirm no 500 errors.

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/scripts/comment-server.js
git commit -m "refactor(ui): remove legacy inline HTML generators, server is now API-first"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Start server with real data**

```bash
node skills/kryptonite/scripts/comment-server.js \
  --state-path skills/kryptonite/data/7147a468863c/readiness-mvp/state.json \
  --spec-path skills/kryptonite/data/7147a468863c/readiness-mvp/spec.html \
  --plan-path skills/kryptonite/data/7147a468863c/readiness-mvp/plan.html
```

- [ ] **Step 2: Test all pages load and render data**

Visit each page, verify:
- Overview: shows parties, repos, tech context, waves, progress
- Stories: kanban with cards, filters work, drawer opens with full detail
- Mocks: gallery shows foundational/detail groups, compare tab shows pending
- Dashboard: wave tables, progress bars, auto-refreshes
- Spec/Plan: dark theme, nav bar, comment system works

- [ ] **Step 3: Test epic switcher**

If multiple epics exist in the project directory, verify the dropdown shows them and switching reloads the page with new data.

- [ ] **Step 4: Test comments**

On Stories page: open drawer, add a comment, resolve it, reload page — verify it persists.

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(ui): end-to-end verification fixes"
```
