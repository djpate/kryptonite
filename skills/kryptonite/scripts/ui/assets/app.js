/* Kryptonite UI — Shared Alpine.js Store & Utilities */

// --- Helpers ---

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Fetch ${path} failed: ${res.status}`);
  return res.json();
}

async function loadNav() {
  const res = await fetch('/ui/assets/nav.html');
  if (!res.ok) return;
  const html = await res.text();
  const container = document.getElementById('nav-container');
  if (!container) return;
  // Safe: nav.html is our own trusted static file served from the same origin.
  // Using DOMParser to parse the HTML into a document fragment.
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  while (doc.body.firstChild) {
    container.appendChild(doc.body.firstChild);
  }
}

// --- Alpine.js Store ---

document.addEventListener('alpine:init', () => {
  Alpine.store('app', {
    epic: null,
    state: null,
    repos: null,
    epics: null,
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
      this.currentEpic = epics.find(e => e.current) || epics[0] || null;
    },

    openDrawer(storyId) {
      if (!this.state || !this.state.stories) return;
      const story = this.state.stories.find(s => s.id === storyId);
      if (story) {
        this.drawerStory = story;
        this.drawerOpen = true;
      }
    },

    closeDrawer() {
      this.drawerOpen = false;
      this.drawerStory = null;
    },

    switchEpic(slug, project_id) {
      fetch('/api/epics/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, project_id }),
      }).then(() => {
        window.location.reload();
      });
    },

    formatStatement(story) {
      if (!story || !story.statement) return '';
      const s = story.statement;
      return `As a ${s.as_a || '?'}, I want to ${s.i_want || '?'} so that ${s.so_that || '?'}`;
    },

    storyTitle(story) {
      if (!story) return '';
      if (story.statement && story.statement.i_want) return story.statement.i_want;
      return story.id;
    },
  });
});

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  loadNav();
});
