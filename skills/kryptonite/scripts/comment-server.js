import http from "node:http";
import fs from "node:fs";
import { parseArgs } from "node:util";

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
const specPath = values["spec-path"];
const planPath = values["plan-path"];
const statePath = values["state-path"];
const visualOnly = values["visual-only"];

if (!specPath && !visualOnly) {
  console.error("Usage: node comment-server.js --spec-path <path> [--plan-path <path>] [--state-path <path>] [--port <port>]");
  console.error("  or:  node comment-server.js --visual-only [--port <port>]");
  process.exit(1);
}

// ─── COMMENT PERSISTENCE ─────────────────────────────────────────────────────

// Derive comments file path from state path (same directory)
const commentsPath = statePath ? statePath.replace(/state\.json$/, "comments.json") : null;

function loadComments() {
  if (!commentsPath) return [];
  try {
    const data = fs.readFileSync(commentsPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveComments() {
  if (!commentsPath) return;
  try {
    fs.writeFileSync(commentsPath, JSON.stringify(comments, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to persist comments:", e.message);
  }
}

const comments = loadComments();
let visualContent = "";
let nextCommentId = comments.length > 0 ? Math.max(...comments.map(c => c.id)) + 1 : 1;
const mockSelections = {}; // { storyId: "option-a" }

function getState() {
  if (!statePath) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatStatement(stmt) {
  if (!stmt) return "";
  if (typeof stmt === "string") return stmt;
  if (typeof stmt === "object" && stmt.as_a) {
    return `As a ${stmt.as_a}, I want to ${stmt.i_want} so that ${stmt.so_that}`;
  }
  return JSON.stringify(stmt);
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
  /* Handled by NAV_COMPAT_STYLE in <head> */

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
    var s = Math.floor((Date.now() - ts) / 1000);
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
      body: JSON.stringify({ section: currentSection, text: text, timestamp: Date.now() })
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
    fetch('/api/comments').then(function(r){ return r.json(); }).then(function(all) {
      var filtered = all.filter(function(c){ return c.section === currentSection; });
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
    fetch('/api/comments').then(function(r){ return r.json(); }).then(function(all) {
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

const NAV_COMPAT_STYLE = `
<style>
  .sidebar {
    top: 48px !important;
    height: calc(100vh - 48px) !important;
  }
</style>
`;

function injectUI(html) {
  if (html.includes("</head>")) {
    html = html.replace("</head>", NAV_COMPAT_STYLE + "</head>");
  }
  if (html.includes("</body>")) {
    let result = html.replace(/<body[^>]*>/, function(match) {
      return match + NAV_BAR;
    });
    result = result.replace("</body>", COMMENT_CLIENT_SCRIPT + "</body>");
    return result;
  }
  return NAV_BAR + html + COMMENT_CLIENT_SCRIPT;
}

// ─── COMPARE VIEW ────────────────────────────────────────────────────────────

function compareHTML() {
  const state = getState();
  if (!state) return `<!DOCTYPE html><html><body><p>No state file found.</p></body></html>`;

  const stories = state.stories || [];
  const visualStories = stories.filter(s => s.has_mock && !s.mock_approved);
  const basePath = statePath ? statePath.replace(/state\.json$/, "") : "";
  const mocksDir = basePath + "mocks/";
  let mockFiles = [];
  try { mockFiles = fs.readdirSync(mocksDir); } catch {}

  // Build comparison data: [{storyId, statement, options: ["option-a.html", "option-b.html"]}]
  const compareData = [];
  for (const story of visualStories) {
    const optionFiles = mockFiles.filter(f => f.startsWith(story.id + "-option-") && f.endsWith(".html"));
    if (optionFiles.length > 0) {
      compareData.push({
        storyId: story.id,
        statement: formatStatement(story.statement),
        options: optionFiles.map(f => ({
          file: f,
          label: f.replace(story.id + "-option-", "").replace(".html", "").toUpperCase()
        }))
      });
    }
  }

  const dataJson = JSON.stringify(compareData).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kryptonite — Compare Mocks</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
    .top-bar { height: 56px; background: ${BRAND.sidebar}; display: flex; align-items: center; padding: 0 24px; border-bottom: 1px solid #334155; flex-shrink: 0; }
    .top-bar .logo { display: flex; align-items: center; gap: 8px; margin-right: 24px; }
    .top-bar .logo .dot { width: 8px; height: 8px; border-radius: 50%; background: ${BRAND.primary}; }
    .top-bar .logo span { font-weight: 600; font-size: 14px; }
    .top-bar .story-info { flex: 1; }
    .top-bar .story-id { font-weight: 600; color: ${BRAND.primary}; font-size: 13px; }
    .top-bar .story-desc { font-size: 12px; color: #94a3b8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 500px; }
    .top-bar .nav-btns { display: flex; gap: 8px; align-items: center; }
    .top-bar .nav-btns button { padding: 8px 16px; border-radius: 6px; border: 1px solid #334155; background: transparent; color: #e2e8f0; cursor: pointer; font-size: 13px; transition: all 0.15s; }
    .top-bar .nav-btns button:hover { background: #1e293b; border-color: #475569; }
    .top-bar .nav-btns button:disabled { opacity: 0.3; cursor: not-allowed; }
    .top-bar .counter { font-size: 12px; color: #64748b; margin: 0 12px; }
    .top-bar .submit-btn { padding: 8px 20px; border-radius: 6px; border: none; background: ${BRAND.primary}; color: #fff; cursor: pointer; font-size: 13px; font-weight: 500; margin-left: 16px; transition: background 0.15s; }
    .top-bar .submit-btn:hover { background: ${BRAND.primaryDark}; }
    .top-bar .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .compare-area { flex: 1; display: flex; gap: 2px; padding: 2px; overflow: hidden; }
    .option-frame { flex: 1; display: flex; flex-direction: column; border-radius: 8px; overflow: hidden; border: 3px solid transparent; cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s; position: relative; }
    .option-frame:hover { border-color: #475569; }
    .option-frame.selected { border-color: ${BRAND.primary}; box-shadow: 0 0 20px ${BRAND.primary}40; }
    .option-label { height: 36px; background: #1e293b; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; letter-spacing: 1px; flex-shrink: 0; }
    .option-frame.selected .option-label { background: ${BRAND.primary}; color: #fff; }
    .option-frame iframe { flex: 1; width: 100%; border: none; background: #fff; pointer-events: none; }
    .option-frame .click-overlay { position: absolute; inset: 36px 0 0 0; cursor: pointer; z-index: 1; }
    .check-mark { position: absolute; top: 44px; right: 8px; width: 28px; height: 28px; border-radius: 50%; background: ${BRAND.primary}; display: none; align-items: center; justify-content: center; color: #fff; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .option-frame.selected .check-mark { display: flex; }
    .empty-state { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; }
    .empty-state p { color: #64748b; font-size: 15px; }
    .done-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: none; align-items: center; justify-content: center; z-index: 9999; flex-direction: column; gap: 16px; }
    .done-overlay.show { display: flex; }
    .done-overlay p { font-size: 18px; color: #e2e8f0; }
    .done-overlay .sub { font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="logo"><div class="dot"></div><span>Compare</span></div>
    <div class="story-info"><div class="story-id" id="story-id"></div><div class="story-desc" id="story-desc"></div></div>
    <div class="nav-btns">
      <button id="prev-btn" onclick="navigate(-1)">&larr; Prev</button>
      <span class="counter" id="counter"></span>
      <button id="next-btn" onclick="navigate(1)">Next &rarr;</button>
      <button class="submit-btn" id="submit-btn" onclick="submitAll()">Submit All Choices</button>
    </div>
  </div>
  <div class="compare-area" id="compare-area"></div>
  <div class="done-overlay" id="done-overlay"><p>All choices submitted!</p><p class="sub">You can close this tab and return to the terminal.</p></div>
  <script>
    var data = ${dataJson};
    var currentIdx = 0;
    var selections = {};

    function render() {
      if (data.length === 0) {
        document.getElementById('compare-area').innerHTML = '<div class="empty-state"><p>No pending mock options to review.</p><p style="font-size:13px;color:#475569;">All mocks are either approved or haven\\'t been generated yet.</p></div>';
        document.getElementById('story-id').textContent = '';
        document.getElementById('story-desc').textContent = '';
        document.getElementById('counter').textContent = '';
        return;
      }
      var item = data[currentIdx];
      document.getElementById('story-id').textContent = item.storyId;
      document.getElementById('story-desc').textContent = item.statement;
      document.getElementById('counter').textContent = (currentIdx + 1) + ' / ' + data.length;
      document.getElementById('prev-btn').disabled = currentIdx === 0;
      document.getElementById('next-btn').disabled = currentIdx === data.length - 1;

      var selectedCount = Object.keys(selections).length;
      var btn = document.getElementById('submit-btn');
      btn.textContent = selectedCount === data.length ? 'Submit All Choices' : selectedCount + '/' + data.length + ' selected';
      btn.disabled = selectedCount < data.length;

      var area = document.getElementById('compare-area');
      area.innerHTML = '';
      item.options.forEach(function(opt) {
        var frame = document.createElement('div');
        frame.className = 'option-frame' + (selections[item.storyId] === opt.file ? ' selected' : '');
        frame.onclick = function() { select(item.storyId, opt.file); };
        frame.innerHTML = '<div class="option-label">' + opt.label + '</div><iframe src="/mocks/' + opt.file + '"></iframe><div class="click-overlay"></div><div class="check-mark">&#10003;</div>';
        area.appendChild(frame);
      });
    }

    function select(storyId, file) {
      selections[storyId] = file;
      fetch('/api/selections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: storyId, choice: file })
      });
      render();
    }

    function navigate(dir) {
      currentIdx = Math.max(0, Math.min(data.length - 1, currentIdx + dir));
      render();
    }

    function submitAll() {
      document.getElementById('done-overlay').classList.add('show');
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowLeft') navigate(-1);
      if (e.key === 'ArrowRight') navigate(1);
      if (e.key >= '1' && e.key <= '9') {
        var item = data[currentIdx];
        if (item && item.options[parseInt(e.key) - 1]) {
          select(item.storyId, item.options[parseInt(e.key) - 1].file);
        }
      }
    });

    render();
  </script>
</body>
</html>`;
}

// ─── MOCKS GALLERY ───────────────────────────────────────────────────────────

function mocksGalleryHTML() {
  const state = getState();
  if (!state) return `<!DOCTYPE html><html><head><title>Kryptonite Mocks</title></head><body>${NAV_BAR}<p style="padding:32px;font-family:sans-serif;">No state file found.</p></body></html>`;

  const stories = state.stories || [];
  const visualStories = stories.filter(s => s.has_mock);
  const direction = state.design_direction || { locked: false, notes: "Not yet established", approved_mocks: [] };

  // Scan mocks directory for all files (including option variants)
  const basePath = statePath ? statePath.replace(/state\.json$/, "") : "";
  const mocksDir = basePath + "mocks/";
  let mockFiles = [];
  try { mockFiles = fs.readdirSync(mocksDir); } catch {}

  let mockCards = "";
  for (const story of visualStories) {
    const storyId = story.id;
    const isApproved = story.mock_approved;
    const stmt = formatStatement(story.statement);

    // Find all files for this story (approved + option variants)
    const storyFiles = mockFiles.filter(f => f.startsWith(storyId));
    const htmlFiles = storyFiles.filter(f => f.endsWith('.html'));
    const pngFiles = storyFiles.filter(f => f.endsWith('.png'));
    const mainPng = pngFiles.find(f => f === `${storyId}.png`) || pngFiles[0];

    // Option variants (e.g., US-013-option-a.html, US-013-option-b.html)
    const optionFiles = htmlFiles.filter(f => f.includes('-option-'));
    const approvedFile = htmlFiles.find(f => f === `${storyId}.html`);

    let optionLinks = "";
    if (optionFiles.length > 0) {
      optionLinks = optionFiles.map(f => {
        const label = f.replace(storyId + '-', '').replace('.html', '').replace('option-', '').toUpperCase();
        return `<a href="/mocks/${f}" target="_blank" style="display:inline-block;padding:4px 10px;margin:2px;font-size:11px;color:${BRAND.primary};border:1px solid ${BRAND.border};border-radius:4px;text-decoration:none;">Option ${label}</a>`;
      }).join('');
    }

    mockCards += `
      <div style="background:${BRAND.bg};border:1px solid ${isApproved ? BRAND.primary : BRAND.border};border-radius:12px;overflow:hidden;transition:box-shadow 0.2s;">
        <div style="aspect-ratio:16/10;background:${BRAND.cardBg};display:flex;align-items:center;justify-content:center;border-bottom:1px solid ${BRAND.border};overflow:hidden;">
          ${mainPng
            ? `<img src="/mocks/${mainPng}" style="width:100%;height:100%;object-fit:cover;" alt="${escapeHtml(storyId)} mock">`
            : `<div style="color:${BRAND.textMuted};font-size:13px;">${htmlFiles.length > 0 ? 'Options ready for review' : 'Mock pending'}</div>`
          }
        </div>
        <div style="padding:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-weight:600;font-size:13px;color:${BRAND.primary};">${storyId}</span>
            ${isApproved ? `<span style="font-size:11px;color:${BRAND.primary};background:${BRAND.primaryLight};padding:2px 8px;border-radius:99px;font-weight:500;">Approved</span>` : `<span style="font-size:11px;color:${BRAND.textMuted};background:${BRAND.cardBg};padding:2px 8px;border-radius:99px;">Pending</span>`}
          </div>
          <p style="font-size:13px;color:${BRAND.text};line-height:1.4;margin:0 0 8px 0;">${escapeHtml(stmt)}</p>
          ${approvedFile ? `<a href="/mocks/${approvedFile}" target="_blank" style="display:inline-block;margin-bottom:4px;font-size:12px;color:${BRAND.primary};text-decoration:none;font-weight:500;">View approved mock &rarr;</a><br>` : ''}
          ${optionLinks ? `<div style="margin-top:8px;">${optionLinks}</div>` : ''}
        </div>
      </div>`;
  }

  if (visualStories.length === 0) {
    mockCards = `<div style="grid-column:1/-1;text-align:center;padding:64px;color:${BRAND.textMuted};">
      <p style="font-size:15px;">No visual stories identified yet.</p>
      <p style="font-size:13px;margin-top:8px;">Visual stories will appear here once the Designer agent produces mocks during Phase 4.</p>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(state.project || "Kryptonite")} — Mocks Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${BRAND.cardBg}; color: ${BRAND.text}; }
  </style>
</head>
<body>
  ${NAV_BAR}
  <div style="max-width:1200px;margin:32px auto;padding:0 24px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
      <div>
        <h1 style="font-size:24px;font-weight:700;">Mocks Gallery</h1>
        <p style="font-size:13px;color:${BRAND.textMuted};margin-top:4px;">${visualStories.length} visual stories${direction.locked ? ' — direction locked' : direction.notes !== 'Not yet established' ? ' — direction established' : ''}</p>
      </div>
      ${direction.notes !== 'Not yet established' ? `
      <div style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:8px;padding:12px 16px;max-width:400px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};font-weight:600;margin-bottom:4px;">Design Direction ${direction.locked ? '(Locked)' : ''}</div>
        <div style="font-size:12px;color:${BRAND.text};line-height:1.4;">${escapeHtml(direction.notes)}</div>
      </div>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;">
      ${mockCards}
    </div>
  </div>
</body>
</html>`;
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function dashboardHTML() {
  const state = getState();
  if (!state) return `<!DOCTYPE html><html><head><title>Kryptonite</title></head><body>${NAV_BAR}<p style="padding:32px;font-family:sans-serif;">No state file found.</p></body></html>`;

  const stories = state.stories || [];
  const waves = state.waves || [];
  const total = stories.length;
  const done = stories.filter((s) => s.status === "done").length;
  const inProgress = stories.filter((s) => s.status === "in_progress").length;
  const blocked = stories.filter((s) => s.status === "blocked").length;
  const pending = stories.filter((s) => s.status === "pending").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  let waveBlocks = "";
  for (const wave of waves) {
    const waveStories = stories.filter((s) => wave.stories.includes(s.id));
    const waveDone = waveStories.filter(s => s.status === "done").length;
    const wavePct = waveStories.length > 0 ? Math.round((waveDone / waveStories.length) * 100) : 0;

    let storyRows = "";
    for (const story of waveStories) {
      const statusColor =
        story.status === "done" ? BRAND.primary :
        story.status === "in_progress" ? BRAND.warning :
        story.status === "blocked" ? BRAND.danger : BRAND.textMuted;
      const testBadge = story.test_results
        ? story.test_results.passed
          ? `<span style="color:${BRAND.primary};font-weight:500;">PASS</span>`
          : `<span style="color:${BRAND.danger};font-weight:500;">FAIL</span>`
        : `<span style="color:${BRAND.textMuted};">—</span>`;

      storyRows += `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};font-weight:500;font-size:13px;">${story.id}</td>
          <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};font-size:13px;max-width:320px;">${escapeHtml(formatStatement(story.statement))}</td>
          <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};text-align:center;">
            <span style="display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;background:${statusColor}18;color:${statusColor};text-transform:uppercase;letter-spacing:0.3px;">${story.status.replace("_", " ")}</span>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:${BRAND.textMuted};">${story.priority || "—"}</td>
          <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};font-family:'SF Mono',monospace;font-size:12px;">${story.commit_sha ? story.commit_sha.slice(0, 7) : "—"}</td>
          <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};font-size:12px;">${testBadge}</td>
          <td style="padding:10px 14px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:${BRAND.textMuted};">${story.implemented_by || "—"}</td>
        </tr>`;
    }

    waveBlocks += `
      <div style="margin-bottom:32px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h3 style="margin:0;font-size:16px;font-weight:600;color:${BRAND.text};">Wave ${wave.id}: ${escapeHtml(wave.name || "")}</h3>
          <span style="font-size:12px;color:${BRAND.textMuted};">${waveDone}/${waveStories.length} done (${wavePct}%)</span>
        </div>
        <div style="background:${BRAND.border};border-radius:4px;height:6px;margin-bottom:16px;overflow:hidden;">
          <div style="background:${BRAND.primary};height:100%;width:${wavePct}%;border-radius:4px;transition:width 0.3s;"></div>
        </div>
        <table style="width:100%;border-collapse:collapse;background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:${BRAND.cardBg};">
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border};">ID</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border};">Story</th>
              <th style="text-align:center;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border};">Status</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border};">Priority</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border};">Commit</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border};">Tests</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${BRAND.textMuted};border-bottom:1px solid ${BRAND.border};">Agent</th>
            </tr>
          </thead>
          <tbody>${storyRows}</tbody>
        </table>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(state.project || "Kryptonite")} — Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: ${BRAND.cardBg}; color: ${BRAND.text}; }
  </style>
</head>
<body>
  ${NAV_BAR}
  <div style="max-width:1100px;margin:32px auto;padding:0 24px;">
    <div style="margin-bottom:32px;">
      <h1 style="font-size:24px;font-weight:700;margin-bottom:4px;">${escapeHtml(state.project || "Project")}</h1>
      <span style="font-size:13px;color:${BRAND.textMuted};">Phase: ${state.phase || "unknown"}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px;">
      <div style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;padding:20px;">
        <div style="font-size:32px;font-weight:700;">${total}</div>
        <div style="font-size:12px;color:${BRAND.textMuted};margin-top:4px;">Total Stories</div>
      </div>
      <div style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;padding:20px;">
        <div style="font-size:32px;font-weight:700;color:${BRAND.primary};">${done}</div>
        <div style="font-size:12px;color:${BRAND.textMuted};margin-top:4px;">Completed</div>
      </div>
      <div style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;padding:20px;">
        <div style="font-size:32px;font-weight:700;color:${BRAND.warning};">${inProgress}</div>
        <div style="font-size:12px;color:${BRAND.textMuted};margin-top:4px;">In Progress</div>
      </div>
      <div style="background:${BRAND.bg};border:1px solid ${BRAND.border};border-radius:10px;padding:20px;">
        <div style="font-size:32px;font-weight:700;color:${BRAND.danger};">${blocked}</div>
        <div style="font-size:12px;color:${BRAND.textMuted};margin-top:4px;">Blocked</div>
      </div>
    </div>
    <div style="background:${BRAND.border};border-radius:6px;height:10px;margin-bottom:8px;overflow:hidden;">
      <div style="background:${BRAND.primary};height:100%;width:${pct}%;border-radius:6px;transition:width 0.3s;"></div>
    </div>
    <p style="text-align:center;color:${BRAND.textMuted};font-size:13px;margin-bottom:40px;">${pct}% complete — ${done} of ${total} stories done</p>
    ${waveBlocks}
  </div>
  <script>setTimeout(function(){location.reload()},10000);</script>
</body>
</html>`;
}

// ─── SERVER ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: comments
  if (url.pathname === "/api/comments" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(comments));
    return;
  }

  if (url.pathname === "/api/comments" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const comment = JSON.parse(body);
        comment.id = nextCommentId++;
        comments.push(comment);
        saveComments();
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(comment));
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
    return;
  }

  // API: update comment
  const putMatch = url.pathname.match(/^\/api\/comments\/(\d+)$/);
  if (putMatch && req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const id = parseInt(putMatch[1], 10);
      const idx = comments.findIndex(c => c.id === id);
      if (idx === -1) { res.writeHead(404); res.end("Not found"); return; }
      try {
        const update = JSON.parse(body);
        comments[idx].text = update.text;
        comments[idx].edited_at = Date.now();
        saveComments();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(comments[idx]));
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
      }
    });
    return;
  }

  // API: delete comment
  const deleteMatch = url.pathname.match(/^\/api\/comments\/(\d+)$/);
  if (deleteMatch && req.method === "DELETE") {
    const id = parseInt(deleteMatch[1], 10);
    const idx = comments.findIndex(c => c.id === id);
    if (idx === -1) { res.writeHead(404); res.end("Not found"); return; }
    comments.splice(idx, 1);
    saveComments();
    res.writeHead(204);
    res.end();
    return;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }

  // API: state
  if (url.pathname === "/api/state" && req.method === "GET") {
    const state = getState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state || { error: "No state file" }));
    return;
  }

  // Mocks gallery
  if (url.pathname === "/mocks") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(mocksGalleryHTML());
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

  // Compare view (fullscreen mock comparison)
  if (url.pathname === "/compare") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(compareHTML());
    return;
  }

  // Dashboard
  if (url.pathname === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(dashboardHTML());
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

  // Spec (root)
  if (url.pathname === "/" || url.pathname === "/spec") {
    if (visualOnly) { res.writeHead(302, { Location: "/visual" }); res.end(); return; }
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
