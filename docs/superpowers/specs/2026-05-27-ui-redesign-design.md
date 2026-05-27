# Kryptonite Web UI Redesign

## Overview

Redesign the kryptonite comment-server web UI from inline template strings to a proper static frontend with DaisyUI + Tailwind + Alpine.js (all CDN, no build step). Dark mode throughout. Adds a Stories kanban board, Overview page, epic switcher, improved mocks gallery, and threaded per-story comments.

## Stack

| Library | Role | Load |
|---------|------|------|
| DaisyUI | Component library (cards, badges, tabs, drawers) | CDN |
| Tailwind CSS | Utility styling | CDN |
| Alpine.js | Reactivity, filters, toggles, drawer state | CDN (~15KB) |

Total payload: ~60KB gzipped. No build step. Dark theme via `data-theme="dark"`.

## Architecture

```
scripts/
├── comment-server.js    (API server: JSON endpoints + static file serving)
└── ui/
    ├── index.html       (Overview page — default route)
    ├── stories.html     (Kanban board)
    ├── mocks.html       (Gallery + Compare tabs)
    ├── dashboard.html   (Execution tracking — wave progress, DOD results)
    ├── shared/
    │   ├── nav.html     (Nav bar partial, loaded via fetch)
    │   ├── drawer.html  (Story detail drawer partial)
    │   └── comments.js  (Comment system shared logic)
    └── assets/
        └── style.css    (Custom dark theme overrides on top of DaisyUI)
```

Spec and Plan pages remain server-injected (external HTML files wrapped with nav + comment system). Everything else is static HTML calling API endpoints.

## Pages

### 1. Overview (`/` → `ui/index.html`)

The epic's README — everything at a glance:

- **Header**: epic name, description, phase badge
- **Progress bar**: overall completion with stat cards (total, done, in progress, waves)
- **Left column**: Parties (name, description, auth, story count), Repos (name, stack, story count), Design Direction (notes, color swatches, locked badge)
- **Right column**: Technical Context (color-coded by domain), Waves (progress bars per wave), Epic Meta (version, created date, mock counts)

Data sources: `epic.json`, `state.json`, `repos.json`

### 2. Stories (`/stories` → `ui/stories.html`)

Kanban board with 5 status columns:

| Column | Status values | Color |
|--------|--------------|-------|
| Pending | `pending` | gray (#64748b) |
| In Progress | `in_progress` | amber (#f59e0b) |
| QA / Review | `qa_validation`, `in_review` | blue (#3b82f6) |
| Code Review | `code_review` | purple (#8b5cf6) |
| Done | `done` | green (#10b981) |

Column backgrounds get a subtle tint of their status color.

**Story Card anatomy:**
- ID + repo (top line, muted)
- Title (truncated `i_want` statement, bold)
- Badges: priority (color-coded), persona, 🖼 if has mock
- Status context line: elapsed time (in progress), DOD results (QA), commit SHA (done)
- Left border color matches column

**Filter bar** (Alpine.js, instant client-side):
- Repo dropdown
- Persona dropdown
- Priority dropdown
- Wave dropdown
- Has Mock toggle
- Search (fuzzy on ID + title)

**Story Detail Drawer** (slides in from right on card click):
- Header: status badge, story ID, close button
- Statement: full as_a / i_want / so_that
- Meta grid (2x2): priority, repo, wave, complexity
- Dependencies: linked story badges with ✓ if done
- Acceptance Criteria: listed with left-border accent
- DOD Checklist: each item with validation method badge (curl/chrome_mcp/test_suite/file_exists), ○/✓ status
- Mock: thumbnail preview if has_mock, click opens full mock
- Comments: threaded per-story comments with resolve toggle
- Execution: started time, agent model, attempts, branch, commit SHA

### 3. Spec (`/spec` — server-injected)

Same injection pattern as today. External spec HTML wrapped with:
- Dark theme nav bar
- Section-level comment badges (hover section → see badge → click to open panel)
- Comment panel (fixed right side, 380px)

### 4. Plan (`/plan` — server-injected)

Same as spec. Section comments stored with `source: "plan"` to distinguish from spec comments.

### 5. Mocks (`/mocks` → `ui/mocks.html`)

Two tabs on one page:

**Gallery tab:**
- Grouped by mock phase: "Foundational Mocks" (with "Direction Locked" badge) and "Detail Mocks"
- Card grid: thumbnail (PNG if exists), story ID, status badge (approved/pending), title
- Click card → opens mock in new tab or opens story drawer

**Compare tab:**
- Shows pending (unapproved) mock stories one at a time
- Side-by-side option frames with labels
- Click to select (green border + glow + checkmark)
- Prev/Next navigation between pending stories
- Keyboard shortcuts: 1/2/3 select, ←/→ navigate
- "Confirm Selection" persists to state.json (survives restart)

### 6. Dashboard (`/dashboard` → `ui/dashboard.html`)

Execution tracking (primarily useful during Phase 12):
- Wave-by-wave progress with per-wave story tables
- DOD validation results
- Agent activity
- Auto-refresh (10s polling or SSE in future)

## Epic Switcher

Dropdown in the nav bar (next to epic name). Lists all epics for the current project.

Each entry shows:
- Status dot: green (current), amber (active, not viewed), gray (completed)
- Epic name
- Phase, story count, % done

Click to switch — server changes active data path, page reloads.

API:
- `GET /api/epics` → list all epics with metadata
- `POST /api/epics/switch` → `{ slug }` → changes server context

## Navigation

Sticky dark top bar on all pages:

```
[● Kryptonite] [epic-name ▾] | Overview | Stories | Spec | Plan | Mocks | Dashboard | [Phase N] [X/Y done]
```

- Active tab: green highlight
- Phase badge: green pill
- Quick stats: story progress

## Comments System

Two comment types in one `comments.json`:

```json
{
  "spec_comments": [
    { "id": "c1", "section": "stories-admin", "source": "spec|plan",
      "text": "...", "timestamp": "...", "resolved": false }
  ],
  "story_comments": [
    { "id": "c2", "story_id": "US-003", "text": "...", "timestamp": "...",
      "resolved": false, "parent_id": null },
    { "id": "c3", "story_id": "US-003", "text": "...", "timestamp": "...",
      "resolved": false, "parent_id": "c2" }
  ]
}
```

**Spec/Plan comments**: section-level, hover-to-reveal badge, side panel. Distinguished by `source` field.

**Story comments**: per-story, shown in drawer. Threaded via `parent_id`. Support:
- Threaded replies (nested under parent)
- Resolve toggle (dims comment, strikes through text)
- Agent replies (kryptonite agents can post "Fixed in abc1234")
- Cmd+Enter to submit

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/state` | Full state.json |
| GET | `/api/epic` | Full epic.json |
| GET | `/api/repos` | repos.json repos array |
| GET | `/api/epics` | List all epics for project |
| POST | `/api/epics/switch` | Switch active epic |
| GET | `/api/comments` | All comments (filter by `?story_id=` or `?section=`) |
| POST | `/api/comments` | Create comment |
| PUT | `/api/comments/:id` | Edit text or toggle resolved |
| DELETE | `/api/comments/:id` | Delete comment |
| GET | `/api/selections` | Mock selections |
| POST | `/api/selections` | Save mock selection (persisted to state.json) |
| GET | `/mocks/:filename` | Serve individual mock files |

## Theme

Dark mode globally. Color palette:

| Role | Color |
|------|-------|
| Page background | `#0f172a` (slate-950) |
| Surface / cards | `#1e293b` (slate-800) |
| Borders | `#334155` (slate-700) |
| Primary text | `#e2e8f0` (slate-200) |
| Muted text | `#64748b` (slate-500) |
| Accent | `#10b981` (emerald-500) |
| Danger/critical | `#f87171` (red-400) |
| Warning/high | `#fbbf24` (amber-400) |
| Info/blue | `#60a5fa` (blue-400) |
| Purple | `#a78bfa` (violet-400) |

## What Changes vs Current

- `comment-server.js` becomes API-focused (strips out inline HTML generation for dashboard/mocks/compare)
- New static `ui/` folder with proper file separation
- Dark mode everywhere
- Kanban board replaces basic story table on dashboard
- Overview page (new)
- Epic switcher (new)
- Story drawer with full detail + mock preview + comments
- Threaded comments with resolve toggle
- Filters: repo, persona, priority, wave, has mock
- Mock selections persisted to state.json
- Mocks gallery grouped by phase (foundational/detail)
- Gallery + Compare merged into one page (tabs)
- Spec/Plan keep injection pattern but get dark theme wrapper
