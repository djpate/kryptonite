import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { values } = parseArgs({
  options: {
    "spec-path": { type: "string" },
    "plan-path": { type: "string" },
    "state-path": { type: "string" },
    "visual-only": { type: "boolean", default: false },
    port: { type: "string", default: "3847" },
  },
});

const PORT = parseInt(values.port, 10);
let specPath = values["spec-path"];
let planPath = values["plan-path"];
let statePath = values["state-path"];
const visualOnly = values["visual-only"];

if (!specPath && !visualOnly) {
  console.error("Usage: node comment-server.js --spec-path <path> [--plan-path <path>] [--state-path <path>] [--port <port>]");
  console.error("  or:  node comment-server.js --visual-only [--port <port>]");
  process.exit(1);
}

// ─── COMMENT PERSISTENCE ─────────────────────────────────────────────────────

function getCommentsPath() {
  return statePath ? statePath.replace(/state\.json$/, "comments.json") : null;
}

function loadComments() {
  const commentsPath = getCommentsPath();
  if (!commentsPath) return { spec_comments: [], story_comments: [] };
  try {
    const data = fs.readFileSync(commentsPath, "utf-8");
    const parsed = JSON.parse(data);
    // Backwards compat: if plain array, treat as spec_comments
    if (Array.isArray(parsed)) {
      return { spec_comments: parsed, story_comments: [] };
    }
    // Ensure both keys exist
    return {
      spec_comments: parsed.spec_comments || [],
      story_comments: parsed.story_comments || [],
    };
  } catch {
    return { spec_comments: [], story_comments: [] };
  }
}

function saveComments() {
  const commentsPath = getCommentsPath();
  if (!commentsPath) return;
  try {
    fs.writeFileSync(commentsPath, JSON.stringify(comments, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to persist comments:", e.message);
  }
}

let comments = loadComments();
let visualContent = "";
const mockSelections = {}; // { storyId: "option-a" }

function getState() {
  if (!statePath) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

function getEpicDir() {
  if (!statePath) return null;
  return path.dirname(statePath);
}

function getProjectDir() {
  const epicDir = getEpicDir();
  if (!epicDir) return null;
  return path.dirname(epicDir);
}

const BRAND = {
  primary: "#10b981",
  primaryDark: "#059669",
  primaryLight: "#d1fae5",
  bg: "#ffffff",
  sidebar: "#1e293b",
  sidebarText: "#e2e8f0",
  text: "#1e293b",
  textMuted: "#64748b",
  border: "#e2e8f0",
  cardBg: "#f8fafc",
  danger: "#ef4444",
  warning: "#f59e0b",
};

// ─── NAV BAR (injected into all pages) ───────────────────────────────────────

const NAV_BAR = `
<nav id="kryp-nav" style="position:sticky;top:0;z-index:9999;background:${BRAND.sidebar};display:flex;align-items:center;padding:0 24px;height:48px;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="display:flex;align-items:center;gap:8px;margin-right:32px;">
    <div style="width:8px;height:8px;border-radius:50%;background:${BRAND.primary};"></div>
    <span style="color:${BRAND.sidebarText};font-weight:600;font-size:14px;">Kryptonite</span>
  </div>
  <a href="/" id="nav-spec" style="color:${BRAND.sidebarText};text-decoration:none;padding:12px 16px;font-size:13px;font-weight:500;border-bottom:2px solid transparent;opacity:0.7;transition:all 0.2s;">Spec</a>
  <a href="/plan" id="nav-plan" style="color:${BRAND.sidebarText};text-decoration:none;padding:12px 16px;font-size:13px;font-weight:500;border-bottom:2px solid transparent;opacity:0.7;transition:all 0.2s;">Plan</a>
  <a href="/dashboard" id="nav-dashboard" style="color:${BRAND.sidebarText};text-decoration:none;padding:12px 16px;font-size:13px;font-weight:500;border-bottom:2px solid transparent;opacity:0.7;transition:all 0.2s;">Dashboard</a>
  <a href="/mocks" id="nav-mocks" style="color:${BRAND.sidebarText};text-decoration:none;padding:12px 16px;font-size:13px;font-weight:500;border-bottom:2px solid transparent;opacity:0.7;transition:all 0.2s;">Mocks</a>
  <a href="/compare" id="nav-compare" style="color:${BRAND.sidebarText};text-decoration:none;padding:12px 16px;font-size:13px;font-weight:500;border-bottom:2px solid transparent;opacity:0.7;transition:all 0.2s;">Compare</a>
  <div style="margin-left:auto;display:flex;align-items:center;gap:12px;">
    <span id="kryp-comment-count" style="color:${BRAND.textMuted};font-size:12px;"></span>
  </div>
</nav>
<script>
(function(){
  var path = location.pathname;
  var active = path === '/plan' ? 'nav-plan' : path === '/dashboard' ? 'nav-dashboard' : path === '/mocks' ? 'nav-mocks' : path === '/compare' ? 'nav-compare' : 'nav-spec';
  var el = document.getElementById(active);
  if (el) { el.style.opacity = '1'; el.style.borderBottomColor = '${BRAND.primary}'; }
})();
</script>
`;

// ─── COMMENT CLIENT SCRIPT ───────────────────────────────────────────────────

const COMMENT_CLIENT_SCRIPT = `
<style>
  /* Comment panel styles */

  [data-section] {
    position: relative;
    border-left: 2px solid transparent;
    padding-left: 10px;
    margin-left: -12px;
    transition: border-color 0.2s;
    border-radius: 4px;
  }
  [data-section]:hover {
    border-left-color: ${BRAND.primary}88;
  }
  .kryp-add-comment-btn {
    position: absolute;
    left: -36px;
    top: 8px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: ${BRAND.textMuted};
    opacity: 0;
    transition: all 0.15s;
  }
  [data-section]:hover > .kryp-add-comment-btn {
    opacity: 1;
    border-color: ${BRAND.border};
    background: ${BRAND.bg};
  }
  .kryp-add-comment-btn:hover {
    background: ${BRAND.primaryLight} !important;
    border-color: ${BRAND.primary} !important;
    color: ${BRAND.primaryDark} !important;
  }
  .kryp-comment-badge {
    position: absolute;
    left: -36px;
    top: 8px;
    min-width: 26px;
    height: 26px;
    border-radius: 50%;
    background: ${BRAND.primary};
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0 6px;
    transition: transform 0.15s, background 0.15s;
  }
  .kryp-comment-badge:hover {
    background: ${BRAND.primaryDark};
    transform: scale(1.1);
  }
  .kryp-panel {
    position: fixed;
    right: 0;
    top: 48px;
    width: 380px;
    height: calc(100vh - 48px);
    background: ${BRAND.bg};
    border-left: 1px solid ${BRAND.border};
    box-shadow: -4px 0 16px rgba(0,0,0,0.08);
    z-index: 9998;
    display: none;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  .kryp-panel.open { display: flex; }
  .kryp-panel-header {
    padding: 16px 20px;
    border-bottom: 1px solid ${BRAND.border};
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .kryp-panel-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: ${BRAND.text}; }
  .kryp-panel-close {
    width: 28px; height: 28px; border: none; background: none; cursor: pointer;
    font-size: 18px; color: ${BRAND.textMuted}; border-radius: 4px; display: flex; align-items: center; justify-content: center;
  }
  .kryp-panel-close:hover { background: ${BRAND.cardBg}; color: ${BRAND.text}; }
  .kryp-panel-body {
    flex: 1; overflow-y: auto; padding: 16px 20px;
  }
  .kryp-panel-footer {
    padding: 12px 20px; border-top: 1px solid ${BRAND.border}; flex-shrink: 0; background: ${BRAND.cardBg};
  }
  .kryp-panel-footer textarea {
    width: 100%; min-height: 64px; border: 1px solid ${BRAND.border}; border-radius: 6px;
    padding: 10px 12px; font-family: inherit; font-size: 13px; resize: vertical; outline: none;
    transition: border-color 0.2s;
  }
  .kryp-panel-footer textarea:focus { border-color: ${BRAND.primary}; }
  .kryp-panel-footer button {
    margin-top: 8px; padding: 8px 16px; background: ${BRAND.primary}; color: #fff;
    border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
    transition: background 0.2s;
  }
  .kryp-panel-footer button:hover { background: ${BRAND.primaryDark}; }
  .kryp-comment-item {
    padding: 12px 0; border-bottom: 1px solid ${BRAND.border};
  }
  .kryp-comment-item:last-child { border-bottom: none; }
  .kryp-comment-text { font-size: 13px; color: ${BRAND.text}; line-height: 1.5; white-space: pre-wrap; }
  .kryp-comment-meta { font-size: 11px; color: ${BRAND.textMuted}; margin-top: 6px; display: flex; align-items: center; gap: 12px; }
  .kryp-comment-actions { display: flex; gap: 8px; margin-left: auto; }
  .kryp-comment-actions button {
    border: none; background: none; cursor: pointer; font-size: 11px; padding: 2px 6px; border-radius: 3px;
    transition: background 0.15s;
  }
  .kryp-comment-actions .kryp-edit-btn { color: ${BRAND.primary}; }
  .kryp-comment-actions .kryp-edit-btn:hover { background: ${BRAND.primaryLight}; }
  .kryp-comment-actions .kryp-delete-btn { color: ${BRAND.danger}; }
  .kryp-comment-actions .kryp-delete-btn:hover { background: #fef2f2; }
  .kryp-empty { text-align: center; color: ${BRAND.textMuted}; font-size: 13px; padding: 32px 0; }
  .kryp-edit-textarea {
    width: 100%; min-height: 48px; border: 1px solid ${BRAND.primary}; border-radius: 4px;
    padding: 8px; font-family: inherit; font-size: 13px; resize: vertical; outline: none;
  }
  .kryp-edit-actions { margin-top: 6px; display: flex; gap: 6px; }
  .kryp-edit-actions button { padding: 4px 10px; font-size: 11px; border-radius: 4px; cursor: pointer; border: none; }
  .kryp-edit-actions .kryp-save { background: ${BRAND.primary}; color: #fff; }
  .kryp-edit-actions .kryp-cancel { background: ${BRAND.cardBg}; color: ${BRAND.text}; border: 1px solid ${BRAND.border}; }
</style>
<div class="kryp-panel" id="kryp-panel">
  <div class="kryp-panel-header">
    <h3 id="kryp-panel-title">Comments</h3>
    <button class="kryp-panel-close" id="kryp-panel-close">&times;</button>
  </div>
  <div class="kryp-panel-body" id="kryp-panel-body"></div>
  <div class="kryp-panel-footer">
    <textarea id="kryp-new-comment" placeholder="Add a comment..."></textarea>
    <button id="kryp-submit-comment">Comment</button>
  </div>
</div>
<script>
(function(){
  var currentSection = null;
  var panel = document.getElementById('kryp-panel');
  var panelBody = document.getElementById('kryp-panel-body');
  var panelTitle = document.getElementById('kryp-panel-title');
  var panelClose = document.getElementById('kryp-panel-close');
  var newCommentArea = document.getElementById('kryp-new-comment');
  var submitBtn = document.getElementById('kryp-submit-comment');

  function timeAgo(ts) {
    var s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }

  function makeCommentable() {
    var sections = document.querySelectorAll('[data-section]');
    for (var i = 0; i < sections.length; i++) {
      var el = sections[i];
      if (el.dataset.krypReady) continue;
      el.dataset.krypReady = '1';
      (function(target) {
        var btn = document.createElement('button');
        btn.className = 'kryp-add-comment-btn';
        btn.textContent = '+';
        btn.title = 'Add comment';
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          openPanel(target.getAttribute('data-section'));
        });
        target.appendChild(btn);
      })(el);
    }
  }

  function openPanel(section) {
    currentSection = section;
    panel.classList.add('open');
    var label = section.replace(/-/g, ' ').replace(/\\b\\w/g, function(c){ return c.toUpperCase(); });
    panelTitle.textContent = label;
    newCommentArea.value = '';
    newCommentArea.focus();
    loadComments();
    document.body.style.marginRight = '380px';
  }

  function closePanel() {
    panel.classList.remove('open');
    currentSection = null;
    document.body.style.marginRight = '0';
  }

  panelClose.addEventListener('click', closePanel);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closePanel();
  });

  submitBtn.addEventListener('click', function() {
    var text = newCommentArea.value.trim();
    if (!text || !currentSection) return;
    fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: currentSection, text: text })
    }).then(function() {
      newCommentArea.value = '';
      loadComments();
      updateBadges();
    });
  });

  newCommentArea.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      submitBtn.click();
    }
  });

  function loadComments() {
    if (!currentSection) return;
    fetch('/api/comments?section=' + encodeURIComponent(currentSection)).then(function(r){ return r.json(); }).then(function(filtered) {
      if (filtered.length === 0) {
        panelBody.innerHTML = '<div class="kryp-empty">No comments yet.<br>Be the first to add one below.</div>';
        return;
      }
      panelBody.innerHTML = '';
      filtered.forEach(function(c) {
        var div = document.createElement('div');
        div.className = 'kryp-comment-item';
        div.dataset.commentId = c.id;

        var textEl = document.createElement('div');
        textEl.className = 'kryp-comment-text';
        textEl.textContent = c.text;

        var meta = document.createElement('div');
        meta.className = 'kryp-comment-meta';
        var time = document.createElement('span');
        time.textContent = timeAgo(c.timestamp);
        meta.appendChild(time);

        var actions = document.createElement('div');
        actions.className = 'kryp-comment-actions';

        var editBtn = document.createElement('button');
        editBtn.className = 'kryp-edit-btn';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', function() { startEdit(div, c); });

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'kryp-delete-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', function() { deleteComment(c.id); });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        meta.appendChild(actions);

        div.appendChild(textEl);
        div.appendChild(meta);
        panelBody.appendChild(div);
      });
    });
  }

  function startEdit(container, comment) {
    var textEl = container.querySelector('.kryp-comment-text');
    var metaEl = container.querySelector('.kryp-comment-meta');
    textEl.style.display = 'none';
    metaEl.style.display = 'none';

    var textarea = document.createElement('textarea');
    textarea.className = 'kryp-edit-textarea';
    textarea.value = comment.text;

    var btns = document.createElement('div');
    btns.className = 'kryp-edit-actions';
    var saveBtn = document.createElement('button');
    saveBtn.className = 'kryp-save';
    saveBtn.textContent = 'Save';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'kryp-cancel';
    cancelBtn.textContent = 'Cancel';

    btns.appendChild(saveBtn);
    btns.appendChild(cancelBtn);
    container.appendChild(textarea);
    container.appendChild(btns);
    textarea.focus();

    cancelBtn.addEventListener('click', function() {
      textarea.remove();
      btns.remove();
      textEl.style.display = '';
      metaEl.style.display = '';
    });

    saveBtn.addEventListener('click', function() {
      var newText = textarea.value.trim();
      if (!newText) return;
      fetch('/api/comments/' + comment.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText })
      }).then(function() {
        textarea.remove();
        btns.remove();
        textEl.textContent = newText;
        textEl.style.display = '';
        metaEl.style.display = '';
      });
    });
  }

  function deleteComment(id) {
    if (!confirm('Delete this comment?')) return;
    fetch('/api/comments/' + id, { method: 'DELETE' }).then(function() {
      loadComments();
      updateBadges();
    });
  }

  function updateBadges() {
    document.querySelectorAll('.kryp-comment-badge').forEach(function(b){ b.remove(); });
    fetch('/api/comments').then(function(r){ return r.json(); }).then(function(data) {
      var all = data.spec_comments || [];
      var countEl = document.getElementById('kryp-comment-count');
      if (countEl) countEl.textContent = all.length > 0 ? all.length + ' comment' + (all.length > 1 ? 's' : '') : '';

      var grouped = {};
      all.forEach(function(c) {
        if (!grouped[c.section]) grouped[c.section] = 0;
        grouped[c.section]++;
      });
      Object.keys(grouped).forEach(function(section) {
        var el = document.querySelector('[data-section="' + CSS.escape(section) + '"]');
        if (!el) return;
        var existing = el.querySelector('.kryp-add-comment-btn');
        if (existing) existing.style.display = 'none';
        var badge = document.createElement('div');
        badge.className = 'kryp-comment-badge';
        badge.textContent = grouped[section];
        badge.addEventListener('click', function(e) {
          e.stopPropagation();
          openPanel(section);
        });
        el.appendChild(badge);
      });
    });
  }

  makeCommentable();
  updateBadges();
  new MutationObserver(makeCommentable).observe(document.body, { childList: true, subtree: true });
})();
</script>
`;

function injectUI(html) {
  const HEAD_INJECTION = `
<style>
  body { background: #0f172a !important; color: #e2e8f0 !important; padding-top: 56px; }
  h1,h2,h3,h4,h5,h6 { color: #f1f5f9 !important; }
  a { color: #60a5fa !important; }
  code, pre { background: #1e293b !important; color: #e2e8f0 !important; }
  table, th, td { border-color: #334155 !important; color: #cbd5e1 !important; }
  th { background: #1e293b !important; }
  section, article, div { border-color: #334155 !important; }
</style>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
<script src="/ui/assets/app.js"></script>
<link rel="stylesheet" href="/ui/assets/style.css">
`;

  const NAV_CONTAINER = `<div id="nav-container" x-data x-init="$store.app.load()"></div>`;

  // Inject dark theme CSS + Alpine.js + app.js + style.css before </head>
  if (html.includes("</head>")) {
    html = html.replace("</head>", HEAD_INJECTION + "</head>");
  }

  // Inject nav container after <body...> tag, plus comment client before </body>
  if (/<body[^>]*>/.test(html)) {
    html = html.replace(/<body[^>]*>/, function(match) {
      return match + NAV_CONTAINER;
    });
    if (html.includes("</body>")) {
      html = html.replace("</body>", COMMENT_CLIENT_SCRIPT + "</body>");
    }
    return html;
  }

  // No body tag found — prepend nav container and append comment client
  return NAV_CONTAINER + html + COMMENT_CLIENT_SCRIPT;
}


// ─── STATIC FILE SERVING ─────────────────────────────────────────────────────
// (legacy inline HTML generators removed — replaced by static pages in ui/)

const UI_DIR = path.join(__dirname, "ui");

const CONTENT_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
};

function serveStaticFile(filePath, res) {
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ─── SERVER ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }

  // ─── Static file serving for /ui/ ───────────────────────────────────────────
  if (url.pathname.startsWith("/ui/")) {
    const relativePath = url.pathname.slice(4); // strip "/ui/"
    const filePath = path.join(UI_DIR, relativePath);
    // Prevent directory traversal
    if (!filePath.startsWith(UI_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!serveStaticFile(filePath, res)) {
      res.writeHead(404);
      res.end("Not found");
    }
    return;
  }

  // ─── API: epic ──────────────────────────────────────────────────────────────
  if (url.pathname === "/api/epic" && req.method === "GET") {
    const epicDir = getEpicDir();
    if (!epicDir) {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "No epic directory" }));
      return;
    }
    const epicPath = path.join(epicDir, "epic.json");
    try {
      const data = fs.readFileSync(epicPath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "epic.json not found" }));
    }
    return;
  }

  // ─── API: repos ─────────────────────────────────────────────────────────────
  if (url.pathname === "/api/repos" && req.method === "GET") {
    const projectDir = getProjectDir();
    if (!projectDir) {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify([]));
      return;
    }
    const reposPath = path.join(projectDir, "repos.json");
    try {
      const data = JSON.parse(fs.readFileSync(reposPath, "utf-8"));
      // Normalize: could be { repos: [...] } or a plain array
      const repos = Array.isArray(data) ? data : (Array.isArray(data.repos) ? data.repos : []);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(repos));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ─── API: epics (list all) ──────────────────────────────────────────────────
  if (url.pathname === "/api/epics" && req.method === "GET") {
    const projectDir = getProjectDir();
    if (!projectDir) {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify([]));
      return;
    }
    const currentEpicDir = getEpicDir();
    try {
      const entries = fs.readdirSync(projectDir, { withFileTypes: true });
      const epics = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const epicJsonPath = path.join(projectDir, entry.name, "epic.json");
        try {
          const epicData = JSON.parse(fs.readFileSync(epicJsonPath, "utf-8"));
          let stateData = null;
          const stateJsonPath = path.join(projectDir, entry.name, "state.json");
          try {
            stateData = JSON.parse(fs.readFileSync(stateJsonPath, "utf-8"));
          } catch {}
          const stories = stateData?.stories || [];
          const doneCount = stories.filter(s => s.status === "done").length;
          const progress = stories.length > 0 ? Math.round((doneCount / stories.length) * 100) : 0;
          epics.push({
            slug: entry.name,
            name: epicData.name || entry.name,
            status: epicData.status || stateData?.phase || "unknown",
            phase: stateData?.phase || epicData.phase || null,
            story_count: stories.length,
            progress,
            current: path.join(projectDir, entry.name) === currentEpicDir,
          });
        } catch {
          // Skip directories without valid epic.json
        }
      }
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(epics));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ─── API: epics/switch ──────────────────────────────────────────────────────
  if (url.pathname === "/api/epics/switch" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { slug } = JSON.parse(body);
        const projectDir = getProjectDir();
        if (!projectDir || !slug) {
          res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ error: "Missing slug or no project directory" }));
          return;
        }
        const newStatePath = path.join(projectDir, slug, "state.json");
        if (!fs.existsSync(newStatePath)) {
          res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ error: "Epic not found: " + slug }));
          return;
        }
        // Switch paths
        statePath = newStatePath;
        specPath = path.join(projectDir, slug, "spec.html");
        planPath = path.join(projectDir, slug, "plan.html");
        // Reload comments for new epic
        comments = loadComments();
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ switched: slug }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // ─── API: comments ──────────────────────────────────────────────────────────
  if (url.pathname === "/api/comments" && req.method === "GET") {
    const storyId = url.searchParams.get("story_id");
    const section = url.searchParams.get("section");
    if (storyId) {
      const filtered = comments.story_comments.filter(c => c.story_id === storyId);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(filtered));
    } else if (section) {
      const filtered = comments.spec_comments.filter(c => c.section === section);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(filtered));
    } else {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(comments));
    }
    return;
  }

  if (url.pathname === "/api/comments" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const comment = {
          id: `c${Date.now()}`,
          text: data.text,
          timestamp: new Date().toISOString(),
          resolved: false,
          parent_id: data.parent_id || null,
        };
        if (data.story_id) {
          comment.story_id = data.story_id;
          comments.story_comments.push(comment);
        } else {
          comment.section = data.section || null;
          comments.spec_comments.push(comment);
        }
        saveComments();
        res.writeHead(201, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(comment));
      } catch {
        res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
        res.end("Invalid JSON");
      }
    });
    return;
  }

  // API: update comment
  const putMatch = url.pathname.match(/^\/api\/comments\/(.+)$/);
  if (putMatch && req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const id = putMatch[1];
      // Search both arrays
      let idx = comments.spec_comments.findIndex(c => c.id === id);
      let arr = comments.spec_comments;
      if (idx === -1) {
        idx = comments.story_comments.findIndex(c => c.id === id);
        arr = comments.story_comments;
      }
      if (idx === -1) { res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("Not found"); return; }
      try {
        const update = JSON.parse(body);
        if (update.text !== undefined) arr[idx].text = update.text;
        if (update.resolved !== undefined) arr[idx].resolved = update.resolved;
        arr[idx].edited_at = new Date().toISOString();
        saveComments();
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify(arr[idx]));
      } catch {
        res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
        res.end("Invalid JSON");
      }
    });
    return;
  }

  // API: delete comment
  const deleteMatch = url.pathname.match(/^\/api\/comments\/(.+)$/);
  if (deleteMatch && req.method === "DELETE") {
    const id = deleteMatch[1];
    // Search both arrays
    let idx = comments.spec_comments.findIndex(c => c.id === id);
    if (idx !== -1) {
      comments.spec_comments.splice(idx, 1);
    } else {
      idx = comments.story_comments.findIndex(c => c.id === id);
      if (idx !== -1) {
        comments.story_comments.splice(idx, 1);
      } else {
        res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        res.end("Not found");
        return;
      }
    }
    saveComments();
    res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    res.end();
    return;
  }

  // API: state
  if (url.pathname === "/api/state" && req.method === "GET") {
    const state = getState();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(state || { error: "No state file" }));
    return;
  }

  // ─── UI page routes ─────────────────────────────────────────────────────────

  // Stories page
  if (url.pathname === "/stories") {
    const filePath = path.join(UI_DIR, "stories.html");
    if (!serveStaticFile(filePath, res)) {
      res.writeHead(404);
      res.end("stories.html not found");
    }
    return;
  }

  // Mocks page
  if (url.pathname === "/mocks") {
    const filePath = path.join(UI_DIR, "mocks.html");
    if (!serveStaticFile(filePath, res)) {
      res.writeHead(404);
      res.end("mocks.html not found");
    }
    return;
  }

  // Dashboard page
  if (url.pathname === "/dashboard") {
    const filePath = path.join(UI_DIR, "dashboard.html");
    if (!serveStaticFile(filePath, res)) {
      res.writeHead(404);
      res.end("dashboard.html not found");
    }
    return;
  }

  // Serve individual mock files (HTML, PNG, any filename under /mocks/)
  const mockMatch = url.pathname.match(/^\/mocks\/(.+\.(html|png|jpg|svg|css|js))$/);
  if (mockMatch) {
    const filename = mockMatch[1];
    const ext = mockMatch[2];
    const basePath = statePath ? statePath.replace(/state\.json$/, "") : "";
    const mockFile = basePath + `mocks/${filename}`;
    try {
      const content = fs.readFileSync(mockFile);
      const contentTypes = { html: "text/html", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", css: "text/css", js: "application/javascript" };
      res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end(`Mock file not found: ${filename}`);
    }
    return;
  }

  // API: mock selections
  if (url.pathname === "/api/selections" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(mockSelections));
    return;
  }

  if (url.pathname === "/api/selections" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { storyId, choice } = JSON.parse(body);
        mockSelections[storyId] = choice;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(mockSelections));
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
    return;
  }

  // Compare view — now a tab in mocks.html
  if (url.pathname === "/compare") {
    res.writeHead(302, { Location: "/mocks" });
    res.end();
    return;
  }

  // Plan
  if (url.pathname === "/plan") {
    if (!planPath) { res.writeHead(404); res.end("Plan not generated yet"); return; }
    try {
      const html = fs.readFileSync(planPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(injectUI(html));
    } catch {
      res.writeHead(404);
      res.end("Plan not generated yet");
    }
    return;
  }

  // Visual companion
  if (url.pathname === "/visual") {
    if (visualContent) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(visualContent);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Kryptonite Visual</title>
        <style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:${BRAND.sidebar};color:${BRAND.sidebarText};}</style>
        </head><body>${NAV_BAR}<p>Waiting for visual content...</p><script>setTimeout(function(){location.reload()},2000);</script></body></html>`);
    }
    return;
  }

  // POST visual content
  if (url.pathname === "/api/visual" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      visualContent = body;
      res.writeHead(200);
      res.end("OK");
    });
    return;
  }

  // Spec (root) or index.html
  if (url.pathname === "/" || url.pathname === "/spec") {
    if (visualOnly) { res.writeHead(302, { Location: "/visual" }); res.end(); return; }

    // Try serving static index.html first (for "/" only)
    if (url.pathname === "/") {
      const indexPath = path.join(UI_DIR, "index.html");
      if (serveStaticFile(indexPath, res)) return;
    }

    // Fall back to spec
    if (!specPath) { res.writeHead(404); res.end("Spec not generated yet"); return; }
    try {
      const html = fs.readFileSync(specPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(injectUI(html));
    } catch (e) {
      res.writeHead(500);
      res.end("Cannot read spec: " + e.message);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    type: "server-started",
    port: PORT,
    url: `http://localhost:${PORT}`,
    spec: visualOnly ? null : `http://localhost:${PORT}/`,
    plan: visualOnly ? null : `http://localhost:${PORT}/plan`,
    dashboard: `http://localhost:${PORT}/dashboard`,
    visual: `http://localhost:${PORT}/visual`,
  }));
});
