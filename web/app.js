/* SourceWeb — a SourceWeb 4 style code browser for the web.
 * Vanilla JS + Monaco. Talks to the FastAPI backend in server/app.py. */
"use strict";

// ---------------------------------------------------------------- utilities
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = {
  get(k, d) { try { const v = localStorage.getItem("sw:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sw:" + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) { location.reload(); throw new Error("unauthorized"); }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.detail || j.error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}
const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
function toast(msg, ms = 2600) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
function log(msg) {
  const row = document.createElement("div");
  row.className = "row";
  row.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $("#logBody").prepend(row);
}
const KIND_LETTER = {
  function: "f", method: "m", member: "m", func: "f", constructor: "c", class: "C", struct: "S", interface: "I",
  trait: "T", component: "C", variable: "v", field: "v", property: "p", local: "l", parameter: "a", type: "T",
  typedef: "T", enum: "E", enumerator: "e", constant: "K", macro: "M", define: "M", alias: "T", namespace: "N",
  module: "N", package: "N", resource: "R", data: "D", output: "O", key: "k", section: "§", heading: "#",
  chapter: "#", subsection: "§", anchor: "⚓", target: "◎", id: "#", selector: "s", object: "o", array: "[",
  string: "\"", number: "#", boolean: "b", null: "∅", var: "v", let: "v", const: "K", getter: "g", setter: "s",
  generator: "f", unknown: "?", file: "📄", dir: "📁",
};
const KIND_CLASS = (k) => (["function", "method", "member", "func", "constructor", "getter", "setter", "generator"].includes(k) ? "function"
  : ["class", "struct", "interface", "trait", "component"].includes(k) ? "class"
  : ["variable", "field", "property", "local", "parameter", "var", "let"].includes(k) ? "variable"
  : ["type", "typedef", "enum", "alias"].includes(k) ? "type"
  : ["constant", "enumerator", "macro", "define", "const"].includes(k) ? "constant"
  : k === "file" ? "file" : k === "dir" ? "dir" : "other");
const kindIcon = (k) => `<span class="ki ${KIND_CLASS(k)}" title="${esc(k)}">${esc(KIND_LETTER[k] || (k || "?")[0])}</span>`;
const baseName = (p) => p.split("/").pop();
const dirName = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";

// --------------------------------------------------------------------- state
const S = {
  projects: [], project: null, files: [], tabs: [], active: null,
  history: [], histIdx: -1, suppressHistory: false,
  names: {}, symbols: [], bookmarks: store.get("bookmarks", []), clips: store.get("clips", []),
  highlights: [], ctxLocked: false, relLocked: false, relSymbol: null, blame: false, readonly: false,
  ptab: store.get("ptab", "files"), ltab: "relation",
};
let monaco, editor, ctxEditor;

// ----------------------------------------------------------------- languages
const EXT_LANG = {
  py: "python", pyi: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", json: "json", md: "markdown", yml: "yaml", yaml: "yaml",
  tf: "hcl", tfvars: "hcl", hcl: "hcl", go: "go", rs: "rust", java: "java", kt: "kotlin", c: "c", h: "c", cpp: "cpp",
  cc: "cpp", hpp: "cpp", cs: "csharp", rb: "ruby", php: "php", sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell",
  sql: "sql", html: "html", htm: "html", css: "css", scss: "scss", less: "less", xml: "xml", svg: "xml", toml: "ini",
  ini: "ini", cfg: "ini", conf: "ini", env: "ini", dockerfile: "dockerfile", graphql: "graphql", proto: "proto",
  swift: "swift", lua: "lua", r: "r", dart: "dart", scala: "scala", rego: "ruby", txt: "plaintext", csv: "plaintext",
};
function langFor(path) {
  const name = baseName(path).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "makefile") return "shell";
  if (name.startsWith(".env")) return "ini";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return EXT_LANG[ext] || "plaintext";
}

// --------------------------------------------------------------------- theme
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set("theme", t);
  if (monaco) monaco.editor.setTheme(t === "dark" ? "sw-dark" : "sw-light");
}

// ------------------------------------------------------------------ commands
const COMMANDS = {};
function cmd(id, label, run, key, monacoKey) { COMMANDS[id] = { id, label, run, key, monacoKey }; }
function runCmd(id, ...a) { const c = COMMANDS[id]; if (!c) return; log(`cmd: ${c.label}`); return c.run(...a); }

const MENUS = {
  File: ["openFileDialog", "saveFile", "saveAll", "closeTab", "closeAllTabs", "-", "reloadFile", "showFileHistory", "compareWithHead", "-", "copyPath", "copyLink"],
  Edit: ["undo", "redo", "-", "find", "replace", "-", "copyToClip", "pasteFromClip", "-", "toggleComment", "formatDocument", "goToLine", "selectBlock"],
  Search: ["searchProject", "searchFile", "lookupReferences", "lookupReferencesWorkspace", "-", "jumpToDefinition", "jumpToCaller", "symbolInfo", "-", "smartRename", "highlightWord", "clearHighlights", "-", "nextResult", "prevResult"],
  Project: ["openProjectDialog", "reindexProject", "browseProjectSymbols", "browseGlobalSymbols", "openFileDialog", "-", "projectReport", "gitBranches", "gitStatus", "gitLog"],
  Navigate: ["goBack", "goForward", "-", "toggleBookmark", "bookmarkList", "nextBookmark", "prevBookmark", "-", "nextTab", "prevTab", "goToSymbolInFile"],
  View: ["toggleSymbolWindow", "toggleProjectWindow", "toggleBottom", "activateContext", "activateRelation", "activateResults", "-", "relationCallers", "relationCallees", "relationHierarchy", "relationMembers", "relationGraph", "-", "toggleBlame", "toggleMinimap", "toggleWrap", "toggleTheme", "zoomIn", "zoomOut"],
  Help: ["showKeys", "showWelcome", "showFindings"],
};

function buildMenus() {
  const nav = $("#menus");
  for (const name of Object.keys(MENUS)) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = (e) => { e.stopPropagation(); openMenu(name, b); };
    b.onmouseenter = () => { if (!$("#menuDrop").hidden) openMenu(name, b); };
    nav.append(b);
  }
  document.addEventListener("click", closeMenu);
}
function openMenu(name, btn) {
  const drop = $("#menuDrop");
  $$("#menus > button").forEach((b) => b.classList.toggle("open", b === btn));
  drop.innerHTML = MENUS[name].map((id) => id === "-" ? `<div class="msep"></div>`
    : `<div class="mi" data-id="${id}"><span>${esc(COMMANDS[id]?.label || id)}</span><span class="key">${esc(COMMANDS[id]?.key || "")}</span></div>`).join("");
  const r = btn.getBoundingClientRect();
  drop.style.left = Math.min(r.left, innerWidth - 280) + "px";
  drop.style.top = r.bottom + "px";
  drop.hidden = false;
  $$(".mi", drop).forEach((mi) => (mi.onclick = (e) => { e.stopPropagation(); closeMenu(); runCmd(mi.dataset.id); }));
}
function closeMenu() { $("#menuDrop").hidden = true; $$("#menus > button").forEach((b) => b.classList.remove("open")); }

// key strings: "Ctrl+Shift+F", "Alt+,", "F7"
function keyString(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  if (k.length === 1) k = k.toUpperCase();
  if (e.code === "Comma") k = ",";
  if (e.code === "Period") k = ".";
  if (e.code === "Slash") k = "/";
  if (e.code === "Equal") k = "=";
  if (e.code === "Quote") k = "'";
  if (["Control", "Shift", "Alt", "Meta"].includes(k)) return "";
  parts.push(k);
  return parts.join("+");
}
function keyMap() {
  const m = {};
  for (const c of Object.values(COMMANDS)) for (const k of (c.key || "").split(/\s*\|\s*/).filter(Boolean)) m[k] = c.id;
  return m;
}

// ---------------------------------------------------------------- navigation
function currentLocation() {
  const t = activeTab();
  if (!t || !editor) return null;
  const p = editor.getPosition();
  return { project: t.project, path: t.path, line: p.lineNumber, col: p.column };
}
function pushHistory(loc) {
  if (!loc || S.suppressHistory) return;
  const cur = S.history[S.histIdx];
  if (cur && cur.project === loc.project && cur.path === loc.path && Math.abs(cur.line - loc.line) < 3) return;
  S.history = S.history.slice(0, S.histIdx + 1);
  S.history.push(loc);
  if (S.history.length > 300) S.history.shift();
  S.histIdx = S.history.length - 1;
  renderHistory();
}
async function goTo(loc, { history = true, focus = true } = {}) {
  if (!loc) return;
  if (history) { pushHistory(currentLocation()); }
  if (loc.project && S.project !== loc.project) await setProject(loc.project, { keepTabs: true });
  await openFile(loc.project || S.project, loc.path, { line: loc.line, col: loc.col, focus, history: false });
  if (history) pushHistory({ project: loc.project || S.project, path: loc.path, line: loc.line || 1, col: loc.col || 1 });
}
async function navHistory(delta) {
  const i = S.histIdx + delta;
  if (i < 0 || i >= S.history.length) return toast(delta < 0 ? "No more history" : "At newest location");
  if (S.histIdx === S.history.length - 1 && delta < 0) {
    const cur = currentLocation();
    const last = S.history[S.histIdx];
    if (cur && last && (cur.path !== last.path || Math.abs(cur.line - last.line) > 2)) { S.history.push(cur); S.histIdx = S.history.length - 1; return navHistory(delta); }
  }
  S.histIdx = i;
  const loc = S.history[i];
  S.suppressHistory = true;
  try { await goTo(loc, { history: false }); } finally { S.suppressHistory = false; }
  renderHistory();
}

// --------------------------------------------------------------------- tabs
const tabKey = (project, path) => `${project}::${path}`;
const activeTab = () => S.tabs.find((t) => t.key === S.active);

async function openFile(project, path, { line, col, focus = true, history = true, rev } = {}) {
  if (!path) return;
  if (history) pushHistory(currentLocation());
  const key = tabKey(project, path) + (rev ? `@${rev}` : "");
  let tab = S.tabs.find((t) => t.key === key);
  if (!tab) {
    let text;
    try { text = await api(`/api/projects/${encodeURIComponent(project)}/file?${q({ path, rev })}`); }
    catch (e) { toast(`Cannot open ${path}: ${e.message}`); return; }
    const uri = monaco.Uri.parse(`sw://${project}/${path}${rev ? "@" + rev : ""}`);
    let model = monaco.editor.getModel(uri);
    if (model) model.setValue(text); else model = monaco.editor.createModel(text, langFor(path), uri);
    tab = { key, project, path, rev, model, view: null, dirty: false, savedVersion: model.getAlternativeVersionId() };
    model.onDidChangeContent(() => {
      const d = model.getAlternativeVersionId() !== tab.savedVersion;
      if (d !== tab.dirty) { tab.dirty = d; renderTabs(); }
      scheduleDecorate();
    });
    S.tabs.push(tab);
  }
  activateTab(tab.key);
  if (line) {
    editor.revealLineInCenterIfOutsideViewport(line);
    editor.setPosition({ lineNumber: line, column: col || 1 });
    editor.setSelection(new monaco.Selection(line, col || 1, line, col || 1));
    flashLine(line);
  }
  if (focus) editor.focus();
  if (history) pushHistory({ project, path, line: line || 1, col: col || 1 });
  return tab;
}
function flashLine(line) {
  const ids = editor.deltaDecorations([], [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "sw-ctx-line" } }]);
  setTimeout(() => editor.deltaDecorations(ids, []), 1200);
}
function activateTab(key) {
  const prev = activeTab();
  if (prev && prev.key !== key) prev.view = editor.saveViewState();
  S.active = key;
  const tab = activeTab();
  $("#welcome").hidden = !!tab;
  if (!tab) { editor.setModel(null); renderTabs(); updateStatus(); return; }
  editor.setModel(tab.model);
  editor.updateOptions({ readOnly: !!tab.rev || S.readonly });
  if (tab.view) editor.restoreViewState(tab.view);
  renderTabs();
  loadFileSymbols();
  updateStatus();
  updateHash();
  if (S.blame) loadBlame();
  store.set("openTabs", S.tabs.filter((t) => !t.rev).map((t) => [t.project, t.path]));
  store.set("activeTab", key);
  highlightInProjectList();
}
function closeTab(key) {
  const tab = S.tabs.find((t) => t.key === key);
  if (!tab) return;
  if (tab.dirty && !confirm(`${tab.path} has unsaved changes. Close anyway?`)) return;
  const i = S.tabs.indexOf(tab);
  S.tabs.splice(i, 1);
  tab.model.dispose();
  if (S.active === key) activateTab(S.tabs[Math.min(i, S.tabs.length - 1)]?.key || null);
  else renderTabs();
  store.set("openTabs", S.tabs.filter((t) => !t.rev).map((t) => [t.project, t.path]));
}
function renderTabs() {
  const el = $("#tabs");
  el.innerHTML = S.tabs.map((t) => `<div class="tab ${t.key === S.active ? "active" : ""} ${t.dirty ? "dirty" : ""}" data-key="${esc(t.key)}" title="${esc(t.project + "/" + t.path)}">
      <span class="tname">${esc(baseName(t.path))}${t.rev ? ` @${esc(t.rev.slice(0, 8))}` : ""}</span>${t.project !== S.project ? `<span class="tproj">${esc(t.project)}</span>` : ""}
      <button class="x" title="Close (Ctrl+W)">×</button></div>`).join("");
  $$(".tab", el).forEach((d) => {
    d.onclick = (e) => { if (e.target.classList.contains("x")) closeTab(d.dataset.key); else activateTab(d.dataset.key); };
    d.onauxclick = (e) => { if (e.button === 1) closeTab(d.dataset.key); };
  });
  $(".tab.active", el)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
async function saveTab(tab = activeTab()) {
  if (!tab || tab.rev) return;
  if (S.readonly) return toast("Server is read-only");
  try {
    await api(`/api/projects/${encodeURIComponent(tab.project)}/file?${q({ path: tab.path })}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: tab.model.getValue() }),
    });
    tab.savedVersion = tab.model.getAlternativeVersionId();
    tab.dirty = false;
    renderTabs();
    toast(`Saved ${tab.path}`);
    log(`saved ${tab.project}/${tab.path}`);
    if (tab.key === S.active) loadFileSymbols();
    loadNames();
  } catch (e) { toast(`Save failed: ${e.message}`); }
}

// ------------------------------------------------------------------ projects
async function loadProjects() {
  S.projects = await api("/api/projects");
  const sel = $("#projectSelect");
  sel.innerHTML = S.projects.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.symbols ? ` (${p.symbols})` : ""}</option>`).join("");
}
async function setProject(name, { keepTabs = true } = {}) {
  if (!name) return;
  S.project = name;
  $("#projectSelect").value = name;
  store.set("project", name);
  document.title = `${name} — SourceWeb`;
  S.files = await api(`/api/projects/${encodeURIComponent(name)}/files`);
  if (!keepTabs) { S.tabs.forEach((t) => t.model.dispose()); S.tabs = []; activateTab(null); }
  renderProjectPane();
  loadNames();
  refreshBranch();
  renderWelcome();
  updateHash();
}
async function refreshBranch() {
  try {
    const st = await api(`/api/projects/${encodeURIComponent(S.project)}/git/status`);
    $("#branchBadge").textContent = `⎇ ${st.branch}${st.changes.length ? ` • ${st.changes.length} changed` : ""}`;
  } catch { $("#branchBadge").textContent = ""; }
}
async function loadNames() {
  S.catData = null; // symbol set changed: categories are rebuilt on next view
  try { S.names = await api(`/api/projects/${encodeURIComponent(S.project)}/names`); } catch { S.names = {}; }
  scheduleDecorate();
}

// ------------------------------------------------------------ project window
function setPtab(t) {
  S.ptab = t; store.set("ptab", t);
  $$("#projectTabs button").forEach((b) => b.classList.toggle("active", b.dataset.ptab === t));
  const f = $("#projectFilter");
  f.placeholder = { files: "Type to filter files…", tree: "Filter tree…", psymbols: "Type a symbol name…", git: "Filter branches/commits…", report: "", categories: "Filter symbols…", workspace: "Filter files in all projects…" }[t] || "Type to filter…";
  f.parentElement.style.display = t === "report" ? "none" : "";
  renderProjectPane();
}
const renderProjectPane = debounce(() => window._renderProjectPane(), 60);
function fuzzyScore(text, query) {
  // Lower is better; -1 = no match. Prefers contiguous / basename matches like SourceWeb's type-ahead.
  const t = text.toLowerCase(), qq = query.toLowerCase();
  if (!qq) return 0;
  const bn = t.slice(t.lastIndexOf("/") + 1);
  if (bn.startsWith(qq)) return 0;
  if (bn.includes(qq)) return 1;
  if (t.includes(qq)) return 2;
  const words = qq.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 3;
  let i = 0;
  for (const ch of t) if (ch === qq[i]) i++;
  return i === qq.length ? 4 : -1;
}
async function _renderProjectPane() {
  const body = $("#projectBody");
  const filter = $("#projectFilter").value.trim();
  if (S.ptab === "files") {
    let items = S.files.map((f) => ({ f, s: fuzzyScore(f, filter) })).filter((x) => x.s >= 0);
    if (filter) items.sort((a, b) => a.s - b.s || a.f.length - b.f.length);
    else items.sort((a, b) => baseName(a.f).localeCompare(baseName(b.f)));
    items = items.slice(0, 3000);
    body.innerHTML = `<div class="group">${items.length} of ${S.files.length} files</div>` + items.map(({ f }) =>
      `<div class="row" data-path="${esc(f)}" title="${esc(f)}">${kindIcon("file")}<span>${esc(baseName(f))}</span><span class="sub">${esc(dirName(f))}</span></div>`).join("");
    $$(".row", body).forEach((r) => (r.onclick = () => openFile(S.project, r.dataset.path)));
    highlightInProjectList();
  } else if (S.ptab === "tree") {
    renderTree(body, filter);
  } else if (S.ptab === "psymbols") {
    if (!filter) { body.innerHTML = `<div class="report muted">Type in the box above to list matching symbols from the whole project (Project Symbol List). Use <span class="kbd">F7</span> for the Browse Project Symbols dialog.</div>`; return; }
    const res = await api(`/api/symbols/search?${q({ q: filter, project: S.project, limit: 400 })}`);
    if ($("#projectFilter").value.trim() !== filter) return;
    body.innerHTML = res.map((s, i) => `<div class="row" data-i="${i}" title="${esc(s.path + ":" + s.line)}">${kindIcon(s.kind)}<span>${esc(s.name)}</span><span class="sub">${esc(s.scope ? s.scope + " · " : "")}${esc(baseName(s.path))}</span></div>`).join("") || `<div class="report muted">No symbols match.</div>`;
    $$(".row", body).forEach((r) => {
      const s = res[+r.dataset.i];
      r.onclick = () => { showContextFor(s); };
      r.ondblclick = () => goTo({ project: s.project, path: s.path, line: s.line });
    });
  } else if (S.ptab === "git") {
    renderGitPane(body, filter);
  } else if (S.ptab === "report") {
    renderReport(body);
  }
}
function highlightInProjectList() {
  const t = activeTab();
  $$("#projectBody .row[data-path]").forEach((r) => r.classList.toggle("sel", !!t && t.project === S.project && r.dataset.path === t.path));
}

const treeOpen = new Set(store.get("treeOpen", []));
function renderTree(body, filter) {
  const root = {};
  const files = filter ? S.files.filter((f) => fuzzyScore(f, filter) >= 0) : S.files;
  for (const f of files) {
    let node = root;
    const parts = f.split("/");
    parts.forEach((p, i) => { if (i === parts.length - 1) (node.__files ||= []).push(f); else node = node[p] ||= {}; });
  }
  const rows = [];
  const walk = (node, prefix, depth) => {
    for (const d of Object.keys(node).filter((k) => k !== "__files").sort()) {
      const path = prefix + d;
      const open = filter || treeOpen.has(path);
      rows.push(`<div class="row" data-dir="${esc(path)}" style="padding-left:${6 + depth * 14}px"><span class="tw">${open ? "▾" : "▸"}</span>${kindIcon("dir")}<span>${esc(d)}</span></div>`);
      if (open) walk(node[d], path + "/", depth + 1);
    }
    for (const f of (node.__files || []).sort()) rows.push(`<div class="row" data-path="${esc(f)}" style="padding-left:${18 + depth * 14}px">${kindIcon("file")}<span>${esc(baseName(f))}</span></div>`);
  };
  walk(root, "", 0);
  body.innerHTML = rows.join("");
  $$(".row[data-dir]", body).forEach((r) => (r.onclick = () => {
    const p = r.dataset.dir;
    treeOpen.has(p) ? treeOpen.delete(p) : treeOpen.add(p);
    store.set("treeOpen", [...treeOpen]);
    renderTree(body, filter);
  }));
  $$(".row[data-path]", body).forEach((r) => (r.onclick = () => openFile(S.project, r.dataset.path)));
  highlightInProjectList();
}

async function renderGitPane(body, filter) {
  const p = encodeURIComponent(S.project);
  body.innerHTML = `<div class="report muted">Loading git data…</div>`;
  const [br, st, lg] = await Promise.all([
    api(`/api/projects/${p}/git/branches`), api(`/api/projects/${p}/git/status`), api(`/api/projects/${p}/git/log?limit=150&all=true`),
  ]);
  const f = filter.toLowerCase();
  const branches = br.branches.filter((b) => !f || b.name.toLowerCase().includes(f) || b.subject.toLowerCase().includes(f));
  const commits = lg.filter((c) => !f || (c.subject + c.author + c.short).toLowerCase().includes(f));
  body.innerHTML = `
    <div class="group">Working tree — ${esc(st.branch)} <span class="muted">${st.changes.length} change(s)</span></div>
    ${st.changes.map((c) => `<div class="row" data-change="${esc(c.path)}"><span class="mono">${esc(c.code)}</span><span>${esc(c.path)}</span></div>`).join("") || `<div class="row muted">clean</div>`}
    <div class="group">Branches (${branches.length}) <span class="muted">click to check out</span></div>
    ${branches.map((b) => `<div class="row ${b.name === br.current ? "sel" : ""}" data-branch="${esc(b.name)}" title="${esc(b.subject)}">⎇ <span>${esc(b.name)}</span><span class="right">${esc(b.date)}</span></div>`).join("")}
    <div class="group">Recent commits (all branches)</div>
    ${commits.map((c) => `<div class="row" data-commit="${esc(c.hash)}" title="${esc(c.subject)}"><span class="mono muted">${esc(c.short)}</span><span class="ellipsis">${esc(c.subject)}</span><span class="right">${esc(c.date)} ${esc(c.author)}</span></div>`).join("")}`;
  $$(".row[data-branch]", body).forEach((r) => (r.onclick = () => checkoutBranch(r.dataset.branch)));
  $$(".row[data-commit]", body).forEach((r) => (r.onclick = () => showCommit(r.dataset.commit)));
  $$(".row[data-change]", body).forEach((r) => (r.onclick = () => showDiff(r.dataset.change)));
}
async function checkoutBranch(name) {
  if (!confirm(`Check out ${name} in ${S.project}? (local working tree only)`)) return;
  try {
    const r = await api(`/api/projects/${encodeURIComponent(S.project)}/git/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: name }) });
    toast(`Checked out ${r.current} — reindexed ${r.symbols} symbols`);
    for (const t of S.tabs.filter((t) => t.project === S.project && !t.rev)) {
      try { const txt = await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: t.path })}`); t.model.setValue(txt); t.savedVersion = t.model.getAlternativeVersionId(); t.dirty = false; } catch { /* file gone on this branch */ }
    }
    await setProject(S.project);
  } catch (e) { toast(`Checkout failed: ${e.message}`, 5000); }
}
async function showTextTab(title, text, lang = "plaintext") {
  const key = `virtual::${title}`;
  let tab = S.tabs.find((t) => t.key === key);
  if (!tab) {
    const model = monaco.editor.createModel(text, lang, monaco.Uri.parse(`sw-virtual://${encodeURIComponent(title)}`));
    tab = { key, project: S.project, path: title, rev: "view", model, dirty: false };
    S.tabs.push(tab);
  } else tab.model.setValue(text);
  activateTab(key);
}
async function showCommit(hash) { showTextTab(`commit ${hash.slice(0, 8)}`, await api(`/api/projects/${encodeURIComponent(S.project)}/git/show?rev=${hash}`), "diff"); }
async function showDiff(path) { showTextTab(`diff ${path}`, await api(`/api/projects/${encodeURIComponent(S.project)}/git/diff?${q({ path })}`) || "(no diff vs HEAD)", "diff"); }

async function renderReport(body) {
  body.innerHTML = `<div class="report muted">Building project report…</div>`;
  const r = await api(`/api/projects/${encodeURIComponent(S.project)}/summary`);
  const maxL = Math.max(1, ...r.languages.map((l) => l[1]));
  const maxK = Math.max(1, ...r.kinds.map((k) => k[1]));
  body.innerHTML = `<div class="report">
    <h3>${esc(r.name)}</h3>
    <div>${r.files} files · ${r.commits} commits · ${r.branches.length} branches · HEAD <b>${esc(r.head)}</b></div>
    <div class="muted">Last: ${esc(r.last_commit)}</div>
    <h3>File types</h3>${r.languages.map(([e, n]) => `<div style="display:flex;gap:6px;align-items:center"><span style="width:90px">${esc(e)}</span><div class="bar" style="width:${(n / maxL) * 60}%"></div><span class="muted">${n}</span></div>`).join("")}
    <h3>Symbols by kind</h3>${r.kinds.slice(0, 14).map(([k, n]) => `<div style="display:flex;gap:6px;align-items:center">${kindIcon(k)}<span style="width:80px">${esc(k)}</span><div class="bar" style="width:${(n / maxK) * 55}%"></div><span class="muted">${n}</span></div>`).join("")}
    <h3>Contributors</h3>${r.authors.map(([n, a]) => `<div>${esc(a)} <span class="muted">${esc(n)}</span></div>`).join("")}
    ${r.readme ? `<h3>README</h3><pre>${esc(r.readme.slice(0, 6000))}</pre>` : ""}
  </div>`;
}

// ------------------------------------------------------------- symbol window
async function loadFileSymbols() {
  const t = activeTab();
  if (!t || t.rev) { S.symbols = []; renderSymbols(); return; }
  try { S.symbols = await api(`/api/projects/${encodeURIComponent(t.project)}/symbols?${q({ path: t.path })}`); }
  catch { S.symbols = []; }
  // drop locals/params from the outline, like SourceWeb's default symbol window filter
  S.symbols = S.symbols.filter((s) => !["local", "parameter"].includes(s.kind) && !/^anonymous(Function|Object|Class)[0-9a-f]+$/.test(s.name));
  renderSymbols();
  scheduleDecorate();
}
function renderSymbols() {
  const f = $("#symbolFilter").value.trim().toLowerCase();
  const list = $("#symbolList");
  const syms = S.symbols.filter((s) => !f || s.name.toLowerCase().includes(f));
  list.innerHTML = syms.map((s, i) => {
    const depth = s.scope ? s.scope.split(/\.|::/).length : 0;
    return `<div class="row" data-i="${S.symbols.indexOf(s)}" style="padding-left:${6 + depth * 12}px" title="${esc(s.kind + " " + (s.signature || ""))}">${kindIcon(s.kind)}<span>${esc(s.name)}</span><span class="sub">${esc(s.signature || "")}</span></div>`;
  }).join("") || `<div class="report muted">${activeTab() ? "No symbols in this file." : "Open a file to see its symbols."}</div>`;
  $$(".row", list).forEach((r) => {
    const s = S.symbols[+r.dataset.i];
    r.onclick = () => { goTo({ project: activeTab().project, path: s.path, line: s.line }, { focus: false }); };
    r.ondblclick = () => editor.focus();
  });
  syncSymbolSelection();
}
function symbolAtLine(line) {
  let best = null;
  for (const s of S.symbols) if (s.line <= line && (s.end || s.line) >= line && (!best || s.line >= best.line)) best = s;
  return best;
}
function syncSymbolSelection() {
  if (!editor?.getModel()) return;
  const s = symbolAtLine(editor.getPosition().lineNumber);
  $$("#symbolList .row").forEach((r) => r.classList.toggle("sel", s && S.symbols[+r.dataset.i] === s));
  $("#symbolList .row.sel")?.scrollIntoView({ block: "nearest" });
  $("#stSymbol").textContent = s ? `${s.scope ? s.scope + "." : ""}${s.name}` : "";
}

// ------------------------------------------------------------ context window
function wordAtCursor() {
  const m = editor.getModel();
  if (!m) return null;
  const sel = editor.getSelection();
  if (sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber) {
    const t = m.getValueInRange(sel).trim();
    if (/^[\w$.]+$/.test(t)) return t.split(".").pop();
  }
  const w = m.getWordAtPosition(editor.getPosition());
  return w ? w.word : null;
}
let ctxReq = 0;
async function updateContext(name) {
  if (S.ctxLocked) return;
  const t = activeTab();
  if (!name || !t) return;
  const id = ++ctxReq;
  let r;
  try { r = await api(`/api/projects/${encodeURIComponent(t.project)}/context?${q({ name, path: t.path, line: editor.getPosition().lineNumber })}`); }
  catch { return; }
  if (id !== ctxReq || !r.def) return;
  showContextResult(r);
}
function showContextResult(r) {
  const d = r.def;
  $("#contextTitle").textContent = `${d.kind} ${d.name} — ${d.project}/${d.path}:${d.line}${r.defs.length > 1 ? `  (+${r.defs.length - 1} more)` : ""}`;
  const model = ctxEditor.getModel();
  monaco.editor.setModelLanguage(model, langFor(d.path));
  model.setValue(r.source);
  ctxEditor.updateOptions({ lineNumbers: (n) => String(n + r.start - 1) });
  const rel = d.line - r.start + 1;
  ctxEditor._decos = ctxEditor.deltaDecorations(ctxEditor._decos || [], [{ range: new monaco.Range(rel, 1, rel, 1), options: { isWholeLine: true, className: "sw-ctx-line" } }]);
  ctxEditor.revealLineNearTop(Math.max(1, rel - 1));
  ctxEditor._def = d;
  ctxEditor._defs = r.defs;
}
async function showContextFor(sym) {
  const r = await api(`/api/projects/${encodeURIComponent(sym.project)}/context?${q({ name: sym.name, path: sym.path })}`);
  const exact = r.defs.find((d) => d.path === sym.path && d.line === sym.line);
  if (exact && exact !== r.def) {
    const src = await api(`/api/projects/${encodeURIComponent(sym.project)}/file?${q({ path: sym.path })}`);
    const lines = src.split("\n");
    const start = Math.max(1, sym.line - 2), end = Math.min(lines.length, Math.max(sym.end || 0, sym.line + 25), sym.line + 200);
    return showContextResult({ def: sym, defs: r.defs, start, source: lines.slice(start - 1, end).join("\n") });
  }
  if (r.def) showContextResult(r);
}

// ----------------------------------------------------------- relation window
function relationTarget() {
  const t = activeTab();
  if (!t) return null;
  const name = wordAtCursor();
  const line = editor.getPosition().lineNumber;
  const sym = S.symbols.find((s) => s.name === name) || null;
  if (name && (S.names[name] || sym)) return { name, project: t.project, path: sym?.path || t.path, line: sym?.line || line, end: sym?.end, kind: sym?.kind || S.names[name] };
  const enc = symbolAtLine(line);
  return enc ? { name: enc.name, project: t.project, path: enc.path, line: enc.line, end: enc.end, kind: enc.kind } : null;
}
async function updateRelation(force = false) {
  if (S.relLocked && !force) return;
  const tgt = relationTarget();
  if (!tgt) return;
  if (!force && S.relSymbol && S.relSymbol.name === tgt.name && S.relSymbol.mode === $("#relationMode").value) return;
  S.relSymbol = { ...tgt, mode: $("#relationMode").value };
  renderRelation();
}
async function relationChildren(node, mode) {
  const p = encodeURIComponent(node.project);
  if (mode === "callers") {
    const res = await api(`/api/projects/${p}/callers?${q({ name: node.name })}`);
    return res.map((r) => ({ ...r, label: r.name, sub: `${r.path}:${r.hits[0]?.line}`, hitLine: r.hits[0]?.line, detail: r.hits.map((h) => h.text).join("\n") }));
  }
  if (mode === "callees") {
    let { path, line, end } = node;
    if (!path || !line) {
      const defs = await api(`/api/projects/${p}/definition?${q({ name: node.name, path: node.path })}`);
      const d = defs.find((x) => ["function", "method", "member", "func", "class"].includes(x.kind)) || defs[0];
      if (!d) return [];
      ({ path, line, end } = d);
    }
    const res = await api(`/api/projects/${p}/callees?${q({ path, line, end })}`);
    return res.map((r) => ({ ...r, label: r.name, sub: `${baseName(r.path)}:${r.line}` }));
  }
  if (mode === "hierarchy") {
    const h = await api(`/api/projects/${p}/hierarchy?${q({ name: node.name })}`);
    return [
      ...h.parents.map((r) => ({ ...r, label: `▲ ${r.name}`, sub: r.external ? "(external base)" : `${baseName(r.path)}:${r.line}`, rel: "parent", leaf: r.external })),
      ...h.children.map((r) => ({ ...r, label: `▼ ${r.name}`, sub: `${baseName(r.path)}:${r.line}`, rel: "child" })),
    ];
  }
  if (mode === "members") {
    const defs = await api(`/api/projects/${p}/definition?${q({ name: node.name, path: node.path })}`);
    const d = defs.find((x) => ["class", "struct", "interface", "trait"].includes(x.kind));
    if (!d) return [];
    const syms = await api(`/api/projects/${encodeURIComponent(d.project)}/symbols?${q({ path: d.path })}`);
    return syms.filter((s) => s.scope && s.scope.split(/\.|::/).pop() === d.name && s.line >= d.line && s.line <= d.end)
      .map((s) => ({ ...s, label: s.name, sub: s.signature || s.typeref || "", leaf: true }));
  }
  return [];
}
async function renderRelation() {
  const body = $("#relationBody");
  const root = S.relSymbol;
  const mode = $("#relationMode").value;
  if (!root) { body.innerHTML = `<div class="report muted">Put the cursor on a symbol. The Relation window follows the selection (lock it with 🔓).</div>`; return; }
  $("#relationTitle").textContent = `${root.name}`;
  body.innerHTML = `<div class="report muted">Computing ${esc(mode)} of ${esc(root.name)}…</div>`;
  const rootNode = { ...root, label: root.name, sub: `${baseName(root.path || "")}`, depth: 0, open: true, children: null };
  try { rootNode.children = await relationChildren(rootNode, mode); } catch (e) { body.innerHTML = `<div class="report">Error: ${esc(e.message)}</div>`; return; }
  if (S.relSymbol !== root) return;
  S.relTree = rootNode;
  ($("#relationView").value === "graph" ? drawRelationGraph : drawRelationOutline)();
}
function drawRelationOutline() {
  const body = $("#relationBody");
  const rows = [];
  const walk = (n, depth, path) => {
    const hasKids = !n.leaf && depth < 8;
    rows.push({ n, depth, path, hasKids });
    if (n.open && n.children) n.children.forEach((c, i) => walk(c, depth + 1, path + "." + i));
  };
  walk(S.relTree, 0, "0");
  body.innerHTML = rows.map(({ n, depth, path, hasKids }) => `<div class="row" data-path="${path}" style="padding-left:${4 + depth * 16}px" title="${esc(n.detail || n.sub || "")}">
    <span class="tw">${hasKids ? (n.open ? "▾" : "▸") : ""}</span>${kindIcon(n.kind || "function")}<span>${esc(n.label)}</span><span class="sub">${esc(n.sub || "")}</span>
    ${n.open && n.children && depth > 0 ? `<span class="right">${n.children.length}</span>` : depth === 0 && n.children ? `<span class="right">${n.children.length} ${esc($("#relationMode").selectedOptions[0].text)}</span>` : ""}</div>`).join("")
    + (S.relTree.children?.length === 0 ? `<div class="report muted">No ${esc($("#relationMode").selectedOptions[0].text.toLowerCase())} found.</div>` : "");
  const nodeAt = (path) => path.split(".").slice(1).reduce((n, i) => n.children[+i], S.relTree);
  $$(".row", body).forEach((r) => {
    const n = nodeAt(r.dataset.path);
    r.querySelector(".tw").onclick = async (e) => {
      e.stopPropagation();
      if (n.leaf) return;
      n.open = !n.open;
      if (n.open && !n.children) { r.querySelector(".tw").textContent = "…"; n.children = await relationChildren(n, $("#relationMode").value); }
      drawRelationOutline();
    };
    r.onclick = () => { $$(".row", body).forEach((x) => x.classList.toggle("sel", x === r)); if (n.path) showContextFor(n); };
    r.ondblclick = () => n.path && goTo({ project: n.project, path: n.path, line: n.hitLine || n.line });
  });
}
function drawRelationGraph() {
  // Horizontal tree graph (SourceWeb's "Graph" view), two levels deep from what's loaded.
  const body = $("#relationBody");
  const root = S.relTree;
  const W = 190, H = 24, GX = 60, GY = 6;
  const nodes = [], edges = [];
  let y = 0;
  const place = (n, depth) => {
    const kids = n.open && n.children ? n.children.slice(0, 60) : [];
    let cy;
    if (!kids.length) { cy = y; y += H + GY; }
    else { const ys = kids.map((k) => place(k, depth + 1)); cy = (ys[0] + ys[ys.length - 1]) / 2; kids.forEach((k, i) => edges.push([depth, cy, depth + 1, ys[i]])); }
    nodes.push({ n, x: depth * (W + GX), y: cy });
    return cy;
  };
  place(root, 0);
  const width = Math.max(...nodes.map((n) => n.x)) + W + 10, height = y + 10;
  const color = (k) => getComputedStyle(document.documentElement).getPropertyValue(KIND_CLASS(k) === "class" ? "--k-class" : "--k-func");
  body.innerHTML = `<svg width="${width}" height="${height}" font-size="11" font-family="var(--mono)">
    ${edges.map(([d1, y1, d2, y2]) => `<path d="M${d1 * (W + GX) + W},${y1 + H / 2} C${d1 * (W + GX) + W + GX / 2},${y1 + H / 2} ${d2 * (W + GX) - GX / 2},${y2 + H / 2} ${d2 * (W + GX)},${y2 + H / 2}" fill="none" stroke="var(--muted)"/>`).join("")}
    ${nodes.map((o, i) => `<g data-i="${i}" style="cursor:pointer"><rect x="${o.x}" y="${o.y}" width="${W}" height="${H}" rx="4" fill="var(--panel-2)" stroke="${color(o.n.kind)}"/>
      <text x="${o.x + 8}" y="${o.y + 16}" fill="var(--text)">${esc((o.n.label || "").slice(0, 26))}</text></g>`).join("")}
  </svg>`;
  $$("g[data-i]", body).forEach((g) => {
    const n = nodes[+g.dataset.i].n;
    g.onclick = async () => {
      if (n.path) showContextFor(n);
      if (!n.leaf && n !== root) { n.open = !n.open; if (n.open && !n.children) n.children = await relationChildren(n, $("#relationMode").value); drawRelationGraph(); }
    };
    g.ondblclick = () => n.path && goTo({ project: n.project, path: n.path, line: n.hitLine || n.line });
  });
}

// ------------------------------------------------------------ search results
let results = [], resultIdx = -1;
function showResults(title, hits, { truncated = false, word } = {}) {
  results = hits; resultIdx = -1;
  setLtab("results");
  $("#resultsCount").textContent = hits.length || "";
  const byFile = new Map();
  hits.forEach((h, i) => { const k = `${h.project}/${h.path}`; if (!byFile.has(k)) byFile.set(k, []); byFile.get(k).push([h, i]); });
  const mark = (h) => {
    if (h.ranges?.length) {
      let out = "", last = 0;
      const enc = new TextEncoder(), dec = new TextDecoder();
      const bytes = enc.encode(h.text);
      for (const [s, e] of h.ranges) { out += esc(dec.decode(bytes.slice(last, s))) + "<mark>" + esc(dec.decode(bytes.slice(s, e))) + "</mark>"; last = e; }
      return out + esc(dec.decode(bytes.slice(last)));
    }
    if (word) return esc(h.text).replace(new RegExp(`\\b${word.replace(/[$]/g, "\\$")}\\b`, "g"), (m) => `<mark>${m}</mark>`);
    return esc(h.text);
  };
  $("#resultsBody").innerHTML = `<div class="group">${esc(title)} — ${hits.length} match(es) in ${byFile.size} file(s)${truncated ? " (truncated)" : ""}</div>` +
    [...byFile.entries()].map(([file, rows]) => `<div class="group" style="position:static;font-weight:600">${kindIcon("file")} ${esc(file)} <span class="muted">(${rows.length})</span></div>` +
      rows.map(([h, i]) => `<div class="row" data-i="${i}"><span class="right" style="margin:0;min-width:42px;text-align:right">${h.line}</span><span class="result-line">${mark(h)}</span></div>`).join("")).join("");
  $$("#resultsBody .row").forEach((r) => {
    r.onclick = () => openResult(+r.dataset.i);
  });
}
function openResult(i) {
  if (i < 0 || i >= results.length) return;
  resultIdx = i;
  const h = results[i];
  $$("#resultsBody .row").forEach((r) => r.classList.toggle("sel", +r.dataset.i === i));
  $(`#resultsBody .row[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  goTo({ project: h.project, path: h.path, line: h.line, col: (h.col || 0) + 1 }, { focus: false });
}

// -------------------------------------------------------------- definitions
async function jumpToDefinition(name = wordAtCursor()) {
  const t = activeTab();
  if (!name || !t) return toast("Put the cursor on a symbol");
  const defs = await api(`/api/projects/${encodeURIComponent(t.project)}/definition?${q({ name, path: t.path })}`);
  const line = editor.getPosition().lineNumber;
  const others = defs.filter((d) => !(d.project === t.project && d.path === t.path && d.line === line));
  const list = others.length ? others : defs;
  if (!list.length) return toast(`Symbol not found: ${name}`);
  const strong = list.filter((d) => !["variable", "parameter", "local", "field", "property"].includes(d.kind));
  if (list.length === 1 || (strong.length === 1 && strong[0] === list[0])) return goTo(list[0]);
  palette({
    title: `Multiple definitions of ${name}`, items: list, value: "",
    render: (d) => `${kindIcon(d.kind)}<span>${esc(d.name)}</span><span class="sub">${esc(d.project !== t.project ? d.project + ": " : "")}${esc(d.path)}:${d.line}</span>`,
    filter: (d, f) => (d.path + d.kind + d.scope).toLowerCase().includes(f.toLowerCase()),
    pick: (d) => goTo(d),
    preview: (d) => showContextFor(d),
  });
}
async function lookupReferences(workspace = false, name = wordAtCursor()) {
  const t = activeTab();
  if (!name) return toast("Put the cursor on a symbol");
  toast(`Looking up references to ${name}…`);
  const hits = await api(`/api/projects/${encodeURIComponent(t?.project || S.project)}/references?${q({ name, workspace })}`);
  showResults(`References to ${name}${workspace ? " (all projects)" : ""}`, hits, { word: name });
  log(`references ${name}: ${hits.length}`);
}

// ---------------------------------------------------------------- palette
let pal = null;
function palette(opts) {
  pal = { sel: 0, items: [], ...opts };
  $("#overlay").hidden = false;
  $("#paletteTitle").textContent = opts.title || "";
  $("#paletteHint").innerHTML = opts.hint || "↑↓ select · Enter open · Esc close";
  $("#paletteOpts").innerHTML = opts.optionsHtml || "";
  $("#paletteList").innerHTML = "";
  const input = $("#paletteInput");
  input.value = opts.value ?? "";
  input.placeholder = opts.placeholder || "";
  input.focus();
  input.select();
  palRefresh();
}
function closePalette() { $("#overlay").hidden = true; pal = null; editor?.focus(); }
const palRefresh = debounce(async () => {
  if (!pal) return;
  const v = $("#paletteInput").value;
  const p = pal;
  let items;
  if (p.fetch) items = await p.fetch(v);
  else items = (p.items || []).filter((i) => !v || (p.filter ? p.filter(i, v) : true));
  if (pal !== p) return;
  p.shown = items.slice(0, 500);
  p.sel = !v && p.initialSel ? Math.min(p.initialSel, p.shown.length - 1) : 0;
  $("#paletteList").innerHTML = p.shown.map((it, i) => `<div class="row ${i === p.sel ? "sel" : ""}" data-i="${i}">${p.render(it)}</div>`).join("") || `<div class="report muted">${v ? "No matches" : (p.empty || "")}</div>`;
  $$("#paletteList .row").forEach((r) => {
    r.onclick = () => { p.sel = +r.dataset.i; palPick(); };
    r.onmouseenter = () => palSel(+r.dataset.i);
  });
  if (p.preview && p.shown[p.sel]) p.preview(p.shown[p.sel]);
}, 90);
function palSel(i) {
  if (!pal?.shown?.length) return;
  pal.sel = (i + pal.shown.length) % pal.shown.length;
  $$("#paletteList .row").forEach((r) => r.classList.toggle("sel", +r.dataset.i === pal.sel));
  $("#paletteList .row.sel")?.scrollIntoView({ block: "nearest" });
  if (pal.preview) pal.preview(pal.shown[pal.sel]);
}
function palPick() { const p = pal; const it = p?.shown?.[p.sel]; closePalette(); if (it) p.pick(it, $("#paletteInput").value); else if (p?.pickText) p.pickText($("#paletteInput").value); }

function openFileDialog() {
  palette({
    title: `Open file — ${S.project}`, placeholder: "file name (fuzzy, space-separated words, dir/name)…",
    fetch: (v) => {
      const items = S.files.map((f) => ({ f, s: fuzzyScore(f, v) })).filter((x) => x.s >= 0);
      if (v) items.sort((a, b) => a.s - b.s || a.f.length - b.f.length);
      return items.map((x) => x.f);
    },
    render: (f) => `${kindIcon("file")}<span>${esc(baseName(f))}</span><span class="sub">${esc(dirName(f))}</span>`,
    pick: (f) => openFile(S.project, f),
  });
}
function browseSymbols(global = false) {
  const t = activeTab();
  palette({
    title: global ? "Browse Global Symbols (all projects)" : `Browse Project Symbols — ${S.project}`,
    placeholder: "symbol name — prefix, substring or initials", value: wordAtCursor() || "",
    optionsHtml: `<label><input type="checkbox" id="palFuncs"> functions/methods only</label><label><input type="checkbox" id="palTypes"> classes/types only</label>`,
    fetch: async (v) => {
      if (!v.trim()) return [];
      const kinds = $("#palFuncs")?.checked ? "function,method,member,func" : $("#palTypes")?.checked ? "class,interface,struct,type,enum" : undefined;
      return api(`/api/symbols/search?${q({ q: v, project: global ? undefined : S.project, limit: 300, kinds })}`);
    },
    empty: "Start typing a symbol name",
    render: (s) => `${kindIcon(s.kind)}<span>${esc(s.name)}</span><span class="sub">${esc(s.scope ? s.scope + " · " : "")}${global ? esc(s.project) + ": " : ""}${esc(s.path)}:${s.line}</span>`,
    pick: (s) => goTo(s),
    preview: debounce((s) => s && showContextFor(s), 120),
  });
  $$("#paletteOpts input").forEach((i) => (i.onchange = palRefresh));
}
function goToSymbolInFile() {
  palette({
    title: "Go to symbol in file", items: S.symbols, placeholder: "symbol…",
    filter: (s, v) => fuzzyScore(s.name, v) >= 0,
    render: (s) => `${kindIcon(s.kind)}<span>${esc(s.name)}</span><span class="sub">${esc(s.scope || "")} :${s.line}</span>`,
    pick: (s) => goTo({ project: activeTab().project, path: s.path, line: s.line }),
  });
}
function searchProject(scopeAll = false) {
  const t = activeTab();
  const sel = editor?.getModel() ? editor.getModel().getValueInRange(editor.getSelection()) : "";
  const last = store.get("lastSearch", { regex: false, case: false, word: false, glob: "", all: false });
  palette({
    title: "Search Project", placeholder: "search text or regex… (Enter to search)",
    value: sel && !sel.includes("\n") ? sel : (wordAtCursor() || ""),
    optionsHtml: `<label><input type="checkbox" id="sRegex" ${last.regex ? "checked" : ""}> Regular expression</label>
      <label><input type="checkbox" id="sCase" ${last.case ? "checked" : ""}> Case sensitive</label>
      <label><input type="checkbox" id="sWord" ${last.word ? "checked" : ""}> Whole words</label>
      <label><input type="checkbox" id="sAll" ${scopeAll || last.all ? "checked" : ""}> All projects</label>
      <label>Files <input id="sGlob" value="${esc(last.glob)}" placeholder="*.py,!tests/**" style="width:150px"></label>`,
    items: [], empty: "Press Enter to search", hint: "Enter search · results go to the Search Results window · F4 / Shift+F4 next/prev",
    render: () => "", pick: () => {},
    pickText: async (v) => {
      if (!v) return;
      const o = { regex: $("#sRegex").checked, case: $("#sCase").checked, word: $("#sWord").checked, glob: $("#sGlob").value, all: $("#sAll").checked };
      store.set("lastSearch", o);
      toast(`Searching for ${v}…`);
      try {
        const r = await api(`/api/search?${q({ q: v, project: o.all ? undefined : (t?.project || S.project), regex: o.regex, case: o.case, word: o.word, glob: o.glob })}`);
        showResults(`Search "${v}"`, r.hits, { truncated: r.truncated });
      } catch (e) { toast(`Search failed: ${e.message}`); }
    },
  });
  // read options before palette closes
  const pt = pal.pickText;
  pal.pickText = (v) => { const o = { regex: $("#sRegex").checked, case: $("#sCase").checked, word: $("#sWord").checked, glob: $("#sGlob").value, all: $("#sAll").checked }; store.set("lastSearch", o); pt(v); };
}

// ------------------------------------------------------------ smart rename
async function smartRename() {
  const t = activeTab();
  const name = wordAtCursor();
  if (!name || !t) return toast("Put the cursor on a symbol to rename");
  const to = prompt(`Smart Rename "${name}" across ${t.project} to:`, name);
  if (!to || to === name) return;
  if (!/^[A-Za-z_$][\w$]*$/.test(to)) return toast("Invalid identifier");
  const hits = await api(`/api/projects/${encodeURIComponent(t.project)}/references?${q({ name })}`);
  const files = [...new Set(hits.map((h) => h.path))];
  if (!confirm(`Replace ${hits.length} whole-word occurrence(s) of "${name}" with "${to}" in ${files.length} file(s)?\n\n${files.slice(0, 25).join("\n")}${files.length > 25 ? "\n…" : ""}`)) return;
  const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  let n = 0;
  for (const f of files) {
    const open = S.tabs.find((x) => x.project === t.project && x.path === f && !x.rev);
    if (open) {
      const m = open.model;
      const edits = [];
      for (let ln = 1; ln <= m.getLineCount(); ln++) {
        const txt = m.getLineContent(ln);
        for (const mm of txt.matchAll(re)) edits.push({ range: new monaco.Range(ln, mm.index + 1, ln, mm.index + 1 + name.length), text: to });
      }
      m.pushEditOperations([], edits, () => null);
      n += edits.length;
      await saveTab(open);
    } else {
      const txt = await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: f })}`);
      const out = txt.replace(re, () => { n++; return to; });
      await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: f })}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: out }) });
    }
  }
  toast(`Renamed ${n} occurrence(s) in ${files.length} file(s)`);
  log(`smart rename ${name} -> ${to}: ${n} in ${files.length} files`);
  lookupReferences(false, to);
}

// --------------------------------------------------------------- bookmarks
function toggleBookmark() {
  const loc = currentLocation();
  if (!loc) return;
  const i = S.bookmarks.findIndex((b) => b.project === loc.project && b.path === loc.path && b.line === loc.line);
  if (i >= 0) S.bookmarks.splice(i, 1);
  else {
    const label = prompt("Bookmark name:", `${baseName(loc.path)}:${loc.line} ${symbolAtLine(loc.line)?.name || ""}`.trim());
    if (label === null) return;
    S.bookmarks.push({ ...loc, label, text: editor.getModel().getLineContent(loc.line).trim().slice(0, 120) });
  }
  store.set("bookmarks", S.bookmarks);
  renderBookmarks();
  decorateBookmarks();
}
function renderBookmarks() {
  $("#bookmarksBody").innerHTML = S.bookmarks.map((b, i) => `<div class="row" data-i="${i}">🔖 <span>${esc(b.label)}</span><span class="sub">${esc(b.project)}/${esc(b.path)}:${b.line} — ${esc(b.text)}</span><button class="mini right" data-del="${i}">✕</button></div>`).join("")
    || `<div class="report muted">No bookmarks. Press <span class="kbd">Ctrl+M</span> on a line to add one.</div>`;
  $$("#bookmarksBody .row").forEach((r) => (r.onclick = (e) => {
    if (e.target.dataset.del) { S.bookmarks.splice(+e.target.dataset.del, 1); store.set("bookmarks", S.bookmarks); renderBookmarks(); decorateBookmarks(); return; }
    goTo(S.bookmarks[+r.dataset.i]);
  }));
}
function cycleBookmark(d) {
  if (!S.bookmarks.length) return toast("No bookmarks");
  S.bmIdx = ((S.bmIdx ?? -1) + d + S.bookmarks.length) % S.bookmarks.length;
  goTo(S.bookmarks[S.bmIdx]);
}

// ------------------------------------------------------------------- clips
function copyToClip() {
  const m = editor.getModel();
  if (!m) return;
  const txt = m.getValueInRange(editor.getSelection());
  if (!txt) return toast("Select text to copy into a clip");
  const name = prompt("Clip name:", txt.trim().split("\n")[0].slice(0, 40));
  if (name === null) return;
  S.clips.unshift({ name, text: txt, lang: m.getLanguageId() });
  store.set("clips", S.clips);
  renderClips();
  setLtab("clip");
}
function insertClip(i) {
  const c = S.clips[i];
  if (!c || !editor.getModel()) return;
  editor.executeEdits("clip", [{ range: editor.getSelection(), text: c.text, forceMoveMarkers: true }]);
  editor.focus();
}
function renderClips() {
  $("#clipBody").innerHTML = S.clips.map((c, i) => `<div class="row" data-i="${i}" title="${esc(c.text.slice(0, 500))}">✂ <span>${esc(c.name)}</span><span class="sub mono">${esc(c.text.replace(/\s+/g, " ").slice(0, 120))}</span><button class="mini right" data-del="${i}">✕</button></div>`).join("")
    || `<div class="report muted">Clip window: select text and use Edit ▸ Copy To Clip. Click a clip to insert it at the cursor.</div>`;
  $$("#clipBody .row").forEach((r) => (r.onclick = (e) => {
    if (e.target.dataset.del) { S.clips.splice(+e.target.dataset.del, 1); store.set("clips", S.clips); renderClips(); return; }
    insertClip(+r.dataset.i);
  }));
}
function renderHistory() {
  $("#historyBody").innerHTML = S.history.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => `<div class="row ${i === S.histIdx ? "sel" : ""}" data-i="${i}">${i === S.histIdx ? "➜" : "&nbsp;&nbsp;"} <span>${esc(baseName(h.path))}:${h.line}</span><span class="sub">${esc(h.project)}/${esc(h.path)}</span></div>`).join("");
  $$("#historyBody .row").forEach((r) => (r.onclick = () => { S.histIdx = +r.dataset.i; S.suppressHistory = true; goTo(S.history[S.histIdx], { history: false }).finally(() => { S.suppressHistory = false; renderHistory(); }); }));
}

// --------------------------------------------------------------- findings
async function renderFindings() {
  let f = [];
  try { f = await api("/api/findings"); } catch { /* none */ }
  $("#findingsBody").innerHTML = f.length ? f.map((x, i) => `<div class="row" data-i="${i}" title="${esc(x.detail || "")}"><span class="sev-${esc(x.severity)}">${esc(x.severity.toUpperCase())}</span><span>${esc(x.title)}</span><span class="sub">${esc(x.project)}/${esc(x.path)}${x.line ? ":" + x.line : ""}</span></div>`).join("")
    : `<div class="report muted">No findings file (data/findings.json).</div>`;
  $$("#findingsBody .row").forEach((r) => (r.onclick = () => { const x = f[+r.dataset.i]; if (x.path) goTo({ project: x.project, path: x.path, line: x.line || 1 }); toast(x.detail || x.title, 6000); }));
}

// ------------------------------------------------------- syntax decorations
let decoIds = [], bmIds = [], hlIds = [], blameIds = [];
const scheduleDecorate = debounce(() => window.decorate(), 250);
function decorate() {
  const m = editor?.getModel();
  const t = activeTab();
  if (!m || !t) return;
  if (m.getValueLength() > 600_000) { decoIds = editor.deltaDecorations(decoIds, []); return; }
  const decos = [];
  const declLines = new Map();
  for (const s of S.symbols) if (!declLines.has(s.line)) declLines.set(s.line, []), declLines.get(s.line).push(s); else declLines.get(s.line).push(s);
  const lines = m.getLinesContent();
  const callable = new Set(["function", "method", "member", "func", "constructor"]);
  const typeish = new Set(["class", "interface", "struct", "component"]);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.length > 1000) continue;
    const decl = declLines.get(i + 1);
    const re = /[A-Za-z_$][\w$]*/g;
    let mm;
    while ((mm = re.exec(text))) {
      const w = mm[0];
      const range = new monaco.Range(i + 1, mm.index + 1, i + 1, mm.index + 1 + w.length);
      const d = decl?.find((s) => s.name === w);
      if (d) {
        decos.push({ range, options: { inlineClassName: callable.has(d.kind) ? "sw-decl-func" : typeish.has(d.kind) ? "sw-decl-class" : "sw-decl", inlineClassNameAffectsLetterSpacing: true } });
        continue;
      }
      const k = S.names[w];
      if (!k) continue;
      decos.push({ range, options: { inlineClassName: callable.has(k) ? "sw-ref-func" : typeish.has(k) ? "sw-ref-class" : k === "constant" || k === "macro" ? "sw-ref-const" : "sw-ref-type" } });
    }
  }
  // auto-annotate closing braces of long blocks (SourceWeb "closing brace annotations")
  for (const s of S.symbols) {
    if (!s.end || s.end - s.line < 12) continue;
    const txt = lines[s.end - 1];
    if (txt && /^\s*[}\])]+[;,)]*\s*$/.test(txt)) {
      decos.push({ range: new monaco.Range(s.end, txt.length + 1, s.end, txt.length + 1), options: { after: { content: `  // ${s.name}`, inlineClassName: "sw-closing-annot" } } });
    }
  }
  decoIds = editor.deltaDecorations(decoIds, decos);
  decorateBookmarks();
  applyHighlights();
}
function decorateBookmarks() {
  const t = activeTab();
  if (!t) return;
  bmIds = editor.deltaDecorations(bmIds, S.bookmarks.filter((b) => b.project === t.project && b.path === t.path)
    .map((b) => ({ range: new monaco.Range(b.line, 1, b.line, 1), options: { isWholeLine: false, linesDecorationsClassName: "sw-bookmark", overviewRuler: { color: "#2f6fd6", position: 4 } } })));
}
function toggleHighlightWord() {
  const w = wordAtCursor();
  if (!w) return;
  const i = S.highlights.indexOf(w);
  if (i >= 0) S.highlights.splice(i, 1); else S.highlights.push(w);
  applyHighlights();
}
function applyHighlights() {
  const m = editor.getModel();
  if (!m) return;
  const decos = [];
  S.highlights.forEach((w, n) => {
    for (const r of m.findMatches(w, false, false, true, "`~!@#%^&*()-=+[{]}\\|;:'\",.<>/?", false)) {
      decos.push({ range: r.range, options: { inlineClassName: `sw-hl-${n % 4}`, overviewRuler: { color: ["#ffd600", "#00c8ff", "#78ff78", "#ff78c8"][n % 4], position: 1 } } });
    }
  });
  hlIds = editor.deltaDecorations(hlIds, decos);
}
async function loadBlame() {
  const t = activeTab();
  if (!S.blame || !t || t.rev) { blameIds = editor.deltaDecorations(blameIds, []); return; }
  const rows = await api(`/api/projects/${encodeURIComponent(t.project)}/git/blame?${q({ path: t.path })}`);
  let prev = "";
  const decos = [];
  for (const r of rows) {
    if (r.hash === prev) continue;
    prev = r.hash;
    const date = new Date(r.time * 1000).toISOString().slice(0, 10);
    decos.push({ range: new monaco.Range(r.line, 1, r.line, 1), options: { after: { content: `    ⎇ ${r.author}, ${date} · ${r.hash} · ${r.summary}`.slice(0, 120), inlineClassName: "sw-blame" }, hoverMessage: { value: `**${r.hash}** ${r.author} — ${date}\n\n${r.summary}` } } });
  }
  const m = editor.getModel();
  for (const d of decos) { const ln = d.range.startLineNumber; const col = m.getLineMaxColumn(ln); d.range = new monaco.Range(ln, col, ln, col); }
  blameIds = editor.deltaDecorations(blameIds, decos);
}

// ---------------------------------------------------------------- status
function updateStatus() {
  const t = activeTab();
  $("#stFile").textContent = t ? `${t.project}/${t.path}` : S.project || "";
  if (editor?.getModel()) {
    const p = editor.getPosition();
    $("#stPos").textContent = `Ln ${p.lineNumber}, Col ${p.column}`;
    $("#stLang").textContent = editor.getModel().getLanguageId();
  } else { $("#stPos").textContent = ""; $("#stLang").textContent = ""; }
}
async function pollIndex() {
  try {
    const st = await api("/api/status");
    S.readonly = st.readonly; S.user = st.user;
    $("#stIndex").textContent = st.index.running ? `Indexing ${st.index.done}/${st.index.total} ${st.index.current}` : "Index ready";
    if (st.index.running) setTimeout(pollIndex, 1500); else if (pollIndex.wasRunning) { loadProjects().then(() => ($("#projectSelect").value = S.project)); loadNames(); }
    pollIndex.wasRunning = st.index.running;
  } catch { /* offline */ }
}

function updateHash() {
  const t = activeTab();
  const p = new URLSearchParams();
  if (S.project) p.set("p", S.project);
  if (t && !t.rev) { p.set("f", t.path); if (editor?.getPosition()) p.set("l", editor.getPosition().lineNumber); if (t.project !== S.project) p.set("fp", t.project); }
  history.replaceState(null, "", "#" + p.toString());
}

// --------------------------------------------------------------- lower tabs
function setLtab(t) {
  S.ltab = t;
  $$("#lowerTabs button").forEach((b) => b.classList.toggle("active", b.dataset.ltab === t));
  $$("#lowerBody .lpanel").forEach((p) => p.classList.toggle("active", p.dataset.lpanel === t));
  if (t === "findings") renderFindings();
  if (window.innerWidth <= 900) document.body.classList.remove("show-symbol", "show-project");
}

// ------------------------------------------------------------------ layout
function initSplitters() {
  const root = document.documentElement;
  const sizes = store.get("layout", {});
  for (const [k, v] of Object.entries(sizes)) root.style.setProperty(k, v);
  $$(".splitter").forEach((sp) => {
    sp.onpointerdown = (e) => {
      e.preventDefault();
      sp.classList.add("drag");
      sp.setPointerCapture(e.pointerId);
      const target = sp.dataset.resize, inv = sp.dataset.invert === "1";
      const startX = e.clientX, startY = e.clientY;
      const varName = { symbolPane: "--symbol-w", projectPane: "--project-w", bottom: "--bottom-h", contextPane: "--context-w" }[target];
      const el = target === "bottom" ? $("#bottom") : $("#" + target);
      const start = target === "bottom" ? el.offsetHeight : el.offsetWidth;
      const move = (ev) => {
        let v;
        if (target === "bottom") v = Math.max(60, Math.min(innerHeight - 200, start - (ev.clientY - startY))) + "px";
        else v = Math.max(120, start + (inv ? -1 : 1) * (ev.clientX - startX)) + "px";
        root.style.setProperty(varName, v);
        sizes[varName] = v;
        editor?.layout(); ctxEditor?.layout();
      };
      const up = () => { sp.classList.remove("drag"); sp.removeEventListener("pointermove", move); store.set("layout", sizes); };
      sp.addEventListener("pointermove", move);
      sp.addEventListener("pointerup", up, { once: true });
    };
  });
}
function togglePane(sel, cls) {
  if (window.innerWidth <= 900) { document.body.classList.toggle(cls); return; }
  const el = $(sel);
  const hidden = el.style.display === "none";
  el.style.display = hidden ? "" : "none";
  const root = document.documentElement;
  if (sel === "#symbolPane") root.style.setProperty("--symbol-w", hidden ? store.get("layout", {})["--symbol-w"] || "250px" : "0px");
  if (sel === "#projectPane") root.style.setProperty("--project-w", hidden ? store.get("layout", {})["--project-w"] || "300px" : "0px");
  if (sel === "#bottom") root.style.setProperty("--bottom-h", hidden ? store.get("layout", {})["--bottom-h"] || "230px" : "0px");
  setTimeout(() => { editor.layout(); ctxEditor.layout(); }, 0);
}

// ---------------------------------------------------------------- welcome
function renderWelcome() {
  const keys = Object.values(COMMANDS).filter((c) => c.key).slice(0, 28);
  $("#welcome").innerHTML = `<h1>SourceWeb</h1>
    <div class="muted">A symbol-aware code browser in your browser · workspace of ${S.projects.length} projects · current: <b>${esc(S.project || "")}</b></div>
    <div class="grid">
      <div class="card" data-c="openFileDialog"><b>📂 Open file</b><span class="muted">Ctrl+P — fuzzy over project files</span></div>
      <div class="card" data-c="browseProjectSymbols"><b>ƒ Browse project symbols</b><span class="muted">F7 — every function, class, variable</span></div>
      <div class="card" data-c="browseGlobalSymbols"><b>🌐 Browse global symbols</b><span class="muted">Ctrl+F7 — across all ${S.projects.length} projects</span></div>
      <div class="card" data-c="searchProject"><b>🔍 Search project</b><span class="muted">Ctrl+Shift+F — ripgrep, regex, globs</span></div>
      <div class="card" data-c="projectReport"><b>📊 Project report</b><span class="muted">languages, symbols, contributors</span></div>
      <div class="card" data-c="showFindings"><b>⚠ Analysis findings</b><span class="muted">security/quality notes linked to code</span></div>
    </div>
    <h3>Projects</h3>
    <div class="grid">${S.projects.map((p) => `<div class="card" data-p="${esc(p.name)}"><b>${esc(p.name)}</b><span class="muted">${p.symbols} symbols</span></div>`).join("")}</div>
    <h3>Keyboard</h3><table>${keys.map((c) => `<tr><td><span class="kbd">${esc(c.key)}</span></td><td>${esc(c.label)}</td></tr>`).join("")}</table>`;
  $$("#welcome .card[data-c]").forEach((c) => (c.onclick = () => runCmd(c.dataset.c)));
  $$("#welcome .card[data-p]").forEach((c) => (c.onclick = () => setProject(c.dataset.p)));
}

// ------------------------------------------------------------- registration
function registerCommands() {
  cmd("openFileDialog", "Open File…", openFileDialog, "Ctrl+P | Ctrl+O");
  cmd("saveFile", "Save", () => saveTab(), "Ctrl+S");
  cmd("saveAll", "Save All", () => S.tabs.filter((t) => t.dirty).forEach((t) => saveTab(t)), "Ctrl+Shift+S");
  cmd("closeTab", "Close File", () => S.active && closeTab(S.active), "Ctrl+W | Ctrl+F4");
  cmd("closeAllTabs", "Close All Files", () => [...S.tabs].forEach((t) => closeTab(t.key)), "Ctrl+Shift+W");
  cmd("reloadFile", "Reload File", async () => { const t = activeTab(); if (!t) return; t.model.setValue(await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: t.path })}`)); t.savedVersion = t.model.getAlternativeVersionId(); t.dirty = false; renderTabs(); });
  cmd("showFileHistory", "File History (git log)", async () => {
    const t = activeTab(); if (!t) return;
    const rows = await api(`/api/projects/${encodeURIComponent(t.project)}/git/log?${q({ path: t.path })}`);
    palette({ title: `History of ${t.path}`, items: rows, filter: (c, v) => (c.subject + c.author).toLowerCase().includes(v.toLowerCase()),
      render: (c) => `<span class="mono muted">${esc(c.short)}</span><span>${esc(c.subject)}</span><span class="right">${esc(c.date)} ${esc(c.author)}</span>`,
      pick: (c) => openFile(t.project, t.path, { rev: c.hash }), hint: "Enter opens the file as it was at that commit" });
  });
  cmd("compareWithHead", "Compare With HEAD (diff)", () => activeTab() && showDiff(activeTab().path));
  cmd("copyPath", "Copy Path", () => { const t = activeTab(); if (t) navigator.clipboard?.writeText(`${t.path}:${editor.getPosition().lineNumber}`).then(() => toast("Path copied")); });
  cmd("copyLink", "Copy Link To Line", () => { updateHash(); navigator.clipboard?.writeText(location.href).then(() => toast("Link copied")); });
  cmd("undo", "Undo", () => editor.trigger("menu", "undo"), "Ctrl+Z");
  cmd("redo", "Redo", () => editor.trigger("menu", "redo"), "Ctrl+Y");
  cmd("find", "Find In File", () => editor.getAction("actions.find").run(), "Ctrl+F");
  cmd("replace", "Replace In File", () => editor.getAction("editor.action.startFindReplaceAction").run(), "Ctrl+H");
  cmd("copyToClip", "Copy To Clip", copyToClip, "Ctrl+Alt+C");
  cmd("pasteFromClip", "Paste From Clip…", () => palette({ title: "Insert clip", items: S.clips, filter: (c, v) => c.name.toLowerCase().includes(v.toLowerCase()), render: (c) => `✂ <span>${esc(c.name)}</span>`, pick: (c) => insertClip(S.clips.indexOf(c)) }), "Ctrl+Alt+V");
  cmd("toggleComment", "Toggle Comment", () => editor.getAction("editor.action.commentLine").run(), "Ctrl+K");
  cmd("formatDocument", "Reformat (Beautify)", () => editor.getAction("editor.action.formatDocument")?.run());
  cmd("goToLine", "Go To Line…", () => editor.getAction("editor.action.gotoLine").run(), "Ctrl+G | F5");
  cmd("selectBlock", "Select Block", () => editor.getAction("editor.action.smartSelect.expand").run(), "Ctrl+-");
  cmd("searchProject", "Search Project…", () => searchProject(false), "Ctrl+Shift+F");
  cmd("searchFile", "Search In File", () => editor.getAction("actions.find").run());
  cmd("lookupReferences", "Lookup References", () => lookupReferences(false), "Ctrl+/ | Shift+F12");
  cmd("lookupReferencesWorkspace", "Lookup References (All Projects)", () => lookupReferences(true), "Ctrl+Shift+/");
  cmd("jumpToDefinition", "Jump To Definition", () => jumpToDefinition(), "Ctrl+= | F12");
  cmd("jumpToCaller", "Jump To Caller", async () => {
    const enc = symbolAtLine(editor.getPosition().lineNumber); if (!enc) return toast("Not inside a function");
    const res = await api(`/api/projects/${encodeURIComponent(activeTab().project)}/callers?${q({ name: enc.name })}`);
    if (!res.length) return toast(`No callers of ${enc.name}`);
    palette({ title: `Callers of ${enc.name}`, items: res, render: (r) => `${kindIcon(r.kind)}<span>${esc(r.name)}</span><span class="sub">${esc(r.path)}:${r.hits[0].line}</span>`, filter: (r, v) => r.name.includes(v), pick: (r) => goTo({ project: r.project, path: r.path, line: r.hits[0].line }), preview: (r) => showContextFor(r) });
  }, "Ctrl+Shift+=");
  cmd("symbolInfo", "Symbol Info", () => editor.getAction("editor.action.showHover").run(), "Alt+F1");
  cmd("smartRename", "Smart Rename…", smartRename, "Ctrl+' | F2");
  cmd("highlightWord", "Highlight Word", toggleHighlightWord, "Shift+F8");
  cmd("clearHighlights", "Clear Highlights", () => { S.highlights = []; applyHighlights(); }, "Ctrl+Shift+F8");
  cmd("nextResult", "Next Search Result", () => openResult(resultIdx + 1), "F4");
  cmd("prevResult", "Previous Search Result", () => openResult(resultIdx - 1), "Shift+F4");
  cmd("openProjectDialog", "Open Project…", () => palette({ title: "Open Project", items: S.projects, filter: (p, v) => fuzzyScore(p.name, v) >= 0, render: (p) => `📁 <span>${esc(p.name)}</span><span class="right">${p.symbols} symbols</span>`, pick: (p) => setProject(p.name) }), "Ctrl+Shift+P");
  cmd("reindexProject", "Synchronize Files (re-index)", async () => { toast("Re-indexing…"); const r = await api(`/api/projects/${encodeURIComponent(S.project)}/reindex`, { method: "POST" }); toast(`Indexed ${r.symbols} symbols in ${r.files} files`); setProject(S.project); }, "Alt+Shift+S");
  cmd("browseProjectSymbols", "Browse Project Symbols…", () => browseSymbols(false), "F7 | Ctrl+T");
  cmd("browseGlobalSymbols", "Browse Global Symbols…", () => browseSymbols(true), "Ctrl+F7");
  cmd("projectReport", "Project Report", () => { setPtab("report"); });
  cmd("gitBranches", "Git: Branches & Commits", () => setPtab("git"));
  cmd("gitStatus", "Git: Working Tree Changes", () => setPtab("git"));
  cmd("gitLog", "Git: File History", () => runCmd("showFileHistory"));
  cmd("goBack", "Go Back", () => navHistory(-1), "Alt+, | Alt+ArrowLeft");
  cmd("goForward", "Go Forward", () => navHistory(1), "Alt+. | Alt+ArrowRight");
  cmd("toggleBookmark", "Bookmark…", toggleBookmark, "Ctrl+M");
  cmd("bookmarkList", "Bookmark List", () => setLtab("bookmarks"));
  cmd("nextBookmark", "Next Bookmark", () => cycleBookmark(1), "F2");
  cmd("prevBookmark", "Previous Bookmark", () => cycleBookmark(-1), "Shift+F2");
  cmd("nextTab", "Next File", () => { const i = S.tabs.findIndex((t) => t.key === S.active); if (S.tabs.length) activateTab(S.tabs[(i + 1) % S.tabs.length].key); }, "Ctrl+Tab | Alt+PageDown");
  cmd("prevTab", "Previous File", () => { const i = S.tabs.findIndex((t) => t.key === S.active); if (S.tabs.length) activateTab(S.tabs[(i - 1 + S.tabs.length) % S.tabs.length].key); }, "Ctrl+Shift+Tab | Alt+PageUp");
  cmd("goToSymbolInFile", "Go To Symbol In File…", goToSymbolInFile, "Ctrl+Shift+O");
  cmd("toggleSymbolWindow", "Symbol Window", () => togglePane("#symbolPane", "show-symbol"), "Alt+F8");
  cmd("toggleProjectWindow", "Project Window", () => togglePane("#projectPane", "show-project"), "Alt+F9");
  cmd("toggleBottom", "Context/Relation Windows", () => togglePane("#bottom", "show-bottom"), "Alt+F10");
  cmd("activateContext", "Activate Context Window", () => ctxEditor.focus(), "Ctrl+Alt+K");
  cmd("activateRelation", "Activate Relation Window", () => { setLtab("relation"); updateRelation(true); }, "Ctrl+Alt+R");
  cmd("activateResults", "Activate Search Results", () => setLtab("results"), "Ctrl+Alt+S");
  cmd("relationCallers", "Relation: References", () => { $("#relationMode").value = "callers"; setLtab("relation"); updateRelation(true); });
  cmd("relationCallees", "Relation: Calls", () => { $("#relationMode").value = "callees"; setLtab("relation"); updateRelation(true); });
  cmd("relationHierarchy", "Relation: Class Inheritance", () => { $("#relationMode").value = "hierarchy"; setLtab("relation"); updateRelation(true); });
  cmd("relationMembers", "Relation: Class Structure", () => { $("#relationMode").value = "members"; setLtab("relation"); updateRelation(true); });
  cmd("relationGraph", "Relation: Toggle Graph/Outline", () => { $("#relationView").value = $("#relationView").value === "graph" ? "outline" : "graph"; S.relTree && ($("#relationView").value === "graph" ? drawRelationGraph() : drawRelationOutline()); });
  cmd("toggleBlame", "Toggle Git Blame", () => { S.blame = !S.blame; loadBlame(); toast(`Blame ${S.blame ? "on" : "off"}`); });
  cmd("toggleMinimap", "Toggle Overview (minimap)", () => { const v = !editor.getOption(monaco.editor.EditorOption.minimap).enabled; editor.updateOptions({ minimap: { enabled: v } }); store.set("minimap", v); });
  cmd("toggleWrap", "Toggle Word Wrap", () => { const v = editor.getOption(monaco.editor.EditorOption.wordWrap) === "off" ? "on" : "off"; editor.updateOptions({ wordWrap: v }); }, "Alt+Z");
  cmd("toggleTheme", "Toggle Light/Dark", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  cmd("zoomIn", "Zoom In", () => { const s = editor.getOption(monaco.editor.EditorOption.fontSize) + 1; editor.updateOptions({ fontSize: s }); store.set("fontSize", s); }, "Ctrl+Shift+=");
  cmd("zoomOut", "Zoom Out", () => { const s = Math.max(8, editor.getOption(monaco.editor.EditorOption.fontSize) - 1); editor.updateOptions({ fontSize: s }); store.set("fontSize", s); }, "Ctrl+Shift+-");
  cmd("showKeys", "Key Assignments", () => palette({ title: "Commands & key assignments", items: Object.values(COMMANDS), filter: (c, v) => (c.label + c.key).toLowerCase().includes(v.toLowerCase()), render: (c) => `<span>${esc(c.label)}</span><span class="right">${esc(c.key || "")}</span>`, pick: (c) => runCmd(c.id) }), "Ctrl+Shift+K | F1");
  cmd("showWelcome", "Welcome / Overview", () => { activateTab(null); });
  cmd("showFindings", "Analysis Findings", () => setLtab("findings"));
  cmd("commandPalette", "Command Palette", () => runCmd("showKeys"), "Ctrl+Shift+A");
  window.extendCommands?.();
}

// ------------------------------------------------------------------- boot
function initEditor() {
  monaco.editor.defineTheme("sw-light", { base: "vs", inherit: true, rules: [
    { token: "comment", foreground: "2e7d32", fontStyle: "italic" }, { token: "keyword", foreground: "0000cc", fontStyle: "bold" },
    { token: "string", foreground: "a31515" }, { token: "number", foreground: "c2185b" }, { token: "type", foreground: "0b6e99" },
  ], colors: { "editor.background": "#ffffff", "editor.lineHighlightBackground": "#f2f6fc", "editorLineNumber.foreground": "#9aa3ae" } });
  monaco.editor.defineTheme("sw-dark", { base: "vs-dark", inherit: true, rules: [
    { token: "comment", foreground: "6a9955", fontStyle: "italic" }, { token: "keyword", foreground: "569cd6", fontStyle: "bold" },
  ], colors: { "editor.background": "#1e1e1e" } });
  const common = { automaticLayout: true, fontFamily: "JetBrains Mono, Cascadia Code, Consolas, DejaVu Sans Mono, monospace", fontSize: store.get("fontSize", 13), scrollBeyondLastLine: false, theme: document.documentElement.dataset.theme === "dark" ? "sw-dark" : "sw-light" };
  editor = monaco.editor.create($("#editor"), { ...common, model: null, minimap: { enabled: store.get("minimap", true) }, glyphMargin: true, smoothScrolling: true, mouseWheelZoom: true, renderWhitespace: "selection", bracketPairColorization: { enabled: true }, stickyScroll: { enabled: true }, "semanticHighlighting.enabled": false });
  ctxEditor = monaco.editor.create($("#contextEditor"), { ...common, value: "", language: "plaintext", readOnly: true, minimap: { enabled: false }, fontSize: Math.max(11, common.fontSize - 1), lineNumbersMinChars: 4, folding: false, renderLineHighlight: "none", scrollbar: { verticalScrollbarSize: 10 } });
  ctxEditor.onMouseDown((e) => { if (e.event.detail === 2 && ctxEditor._def) goTo({ project: ctxEditor._def.project, path: ctxEditor._def.path, line: ctxEditor._def.line }); });

  // Ctrl+click / F12 -> definition through Monaco's own provider; works for every language we map.
  const langs = [...new Set(Object.values(EXT_LANG))];
  for (const lang of langs) {
    monaco.languages.registerDefinitionProvider(lang, {
      provideDefinition: async (model, pos) => {
        const w = model.getWordAtPosition(pos);
        const t = S.tabs.find((x) => x.model === model);
        if (!w || !t) return null;
        if (window.languageDefinition) { const r = await window.languageDefinition(model, pos, t); if (r) return r; }
        const defs = await api(`/api/projects/${encodeURIComponent(t.project)}/definition?${q({ name: w.word, path: t.path })}`);
        return defs.slice(0, 20).map((d) => ({ uri: monaco.Uri.parse(`sw://${d.project}/${d.path}`), range: new monaco.Range(d.line, 1, d.line, 1) }));
      },
    });
    monaco.languages.registerHoverProvider(lang, {
      provideHover: async (model, pos) => {
        const w = model.getWordAtPosition(pos);
        const t = S.tabs.find((x) => x.model === model);
        if (!w || !t || !S.names[w.word]) return null;
        const defs = await api(`/api/projects/${encodeURIComponent(t.project)}/definition?${q({ name: w.word, path: t.path })}`);
        if (!defs.length) return null;
        const d = defs[0];
        return { contents: [{ value: `**${d.kind}** \`${d.scope ? d.scope + "." : ""}${d.name}${d.signature || ""}\`${d.typeref ? ` : ${d.typeref}` : ""}` }, { value: `${d.project}/${d.path}:${d.line}${defs.length > 1 ? ` · ${defs.length} definitions` : ""}` }] };
      },
    });
  }
  // Monaco opens a definition URI through the editor service; intercept to use our tabs.
  const svc = editor._codeEditorService;
  const orig = svc.openCodeEditor.bind(svc);
  svc.openCodeEditor = async (input, source, side) => {
    const u = input.resource;
    if (u.scheme === "sw") {
      const project = u.authority, path = decodeURIComponent(u.path.slice(1));
      await goTo({ project, path, line: input.options?.selection?.startLineNumber || 1 });
      return editor;
    }
    return orig(input, source, side);
  };

  // Override Monaco keys that collide with SourceWeb bindings.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => runCmd("lookupReferences"));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => runCmd("jumpToDefinition"));
  editor.addCommand(monaco.KeyCode.F12, () => runCmd("jumpToDefinition"));
  editor.addCommand(monaco.KeyCode.F2, () => runCmd("nextBookmark"));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => runCmd("toggleComment"));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => runCmd("openFileDialog"));
  editor.addCommand(monaco.KeyCode.F1, () => runCmd("showKeys"));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => runCmd("goToLine"));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => runCmd("saveFile"));

  const onCursor = debounce(() => {
    syncSymbolSelection();
    updateContext(wordAtCursor());
    if (S.ltab === "relation") updateRelation();
    updateHash();
  }, 280);
  editor.onDidChangeCursorPosition(() => { updateStatus(); onCursor(); });
  editor.onDidChangeModel(() => setTimeout(decorate, 0));
  editor.onMouseDown((e) => { if (e.event.detail === 2) setTimeout(() => updateRelation(true), 50); });
  window.extendEditor?.();
}

function bindUI() {
  $("#projectSelect").onchange = (e) => setProject(e.target.value);
  $("#branchBadge").onclick = () => setPtab("git");
  $("#themeBtn").onclick = () => runCmd("toggleTheme");
  $$("#toolbar button[data-cmd]").forEach((b) => (b.onclick = () => runCmd(b.dataset.cmd)));
  $$("#projectTabs button").forEach((b) => (b.onclick = () => setPtab(b.dataset.ptab)));
  $$("#lowerTabs button").forEach((b) => (b.onclick = () => setLtab(b.dataset.ltab)));
  $("#projectFilter").oninput = renderProjectPane;
  $("#projectFilter").onkeydown = (e) => {
    if (e.key === "Enter") { const r = $("#projectBody .row[data-path], #projectBody .row[data-i]"); r?.click(); r?.dispatchEvent(new MouseEvent("dblclick")); }
  };
  $("#symbolFilter").oninput = renderSymbols;
  $("#relationMode").onchange = () => updateRelation(true);
  $("#relationView").onchange = () => S.relTree && ($("#relationView").value === "graph" ? drawRelationGraph() : drawRelationOutline());
  $("#relationRefresh").onclick = () => updateRelation(true);
  $("#relationLock").onclick = (e) => { S.relLocked = !S.relLocked; e.target.textContent = S.relLocked ? "🔒" : "🔓"; e.target.classList.toggle("on", S.relLocked); };
  $("#contextLock").onclick = (e) => { S.ctxLocked = !S.ctxLocked; e.target.textContent = S.ctxLocked ? "🔒" : "🔓"; e.target.classList.toggle("on", S.ctxLocked); };
  $("#quickSymbol").onfocus = (e) => { e.target.blur(); browseSymbols(false); };
  $("#paletteInput").oninput = () => { if (!pal?.pickText || pal.fetch || pal.items?.length) palRefresh(); };
  $("#paletteInput").onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palSel(pal.sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palSel(pal.sel - 1); }
    else if (e.key === "Enter") { e.preventDefault(); palPick(); }
    else if (e.key === "Escape") { closePalette(); }
  };
  $("#overlay").onmousedown = (e) => { if (e.target.id === "overlay") closePalette(); };
  const km = () => keyMap();
  document.addEventListener("keydown", (e) => {
    if (!$("#overlay").hidden) return;
    const ks = keyString(e);
    if (!ks) return;
    const id = km()[ks];
    if (!id) return;
    const inMonaco = document.activeElement?.closest?.(".monaco-editor");
    const inInput = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) && !inMonaco;
    if (inInput && !/^((Shift\+)?F\d+|Ctrl\+|Alt\+)/.test(ks)) return;
    if (inMonaco && ["undo", "redo", "find", "replace"].includes(id)) return; // let Monaco handle natively
    e.preventDefault(); e.stopPropagation();
    runCmd(id);
  }, true);
  window.addEventListener("beforeunload", (e) => { if (S.tabs.some((t) => t.dirty)) { e.preventDefault(); e.returnValue = ""; } });
  window.addEventListener("hashchange", () => restoreFromHash());
  // mobile nav buttons
  const mn = document.createElement("div");
  mn.id = "mobileNav";
  mn.innerHTML = `<button class="icon-btn" title="Symbols">☰</button><button class="icon-btn" title="Files">📁</button>`;
  $("#menubar").insertBefore(mn, $("#menubar .spacer"));
  mn.children[0].onclick = () => { document.body.classList.remove("show-project"); document.body.classList.toggle("show-symbol"); };
  mn.children[1].onclick = () => { document.body.classList.remove("show-symbol"); document.body.classList.toggle("show-project"); };
  $("#projectBody").addEventListener("click", (e) => { if (window.innerWidth <= 900 && e.target.closest(".row[data-path]")) document.body.classList.remove("show-project"); });
  $("#symbolList").addEventListener("click", () => { if (window.innerWidth <= 900) document.body.classList.remove("show-symbol"); });
}

async function restoreFromHash(hash = location.hash) {
  const p = new URLSearchParams(hash.slice(1));
  const proj = p.get("p");
  if (proj && proj !== S.project && S.projects.some((x) => x.name === proj)) await setProject(proj);
  const f = p.get("f");
  if (f) {
    const fp = p.get("fp") || S.project;
    const l = +p.get("l") || 1;
    const t = activeTab();
    if (!t || t.path !== f || t.project !== fp || editor.getPosition().lineNumber !== l) await openFile(fp, f, { line: l });
  }
}

// Monaco rejects in-flight work with a "Canceled" error when models are swapped; that is expected.
window.addEventListener("unhandledrejection", (e) => { if (e.reason?.name === "Canceled" || e.reason?.message === "Canceled") e.preventDefault(); });

async function boot() {
  const initialHash = location.hash;
  applyTheme(store.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  registerCommands();
  buildMenus();
  initSplitters();
  bindUI();
  await new Promise((res) => {
    const vs = `${location.origin}/vendor/monaco/vs`;
    window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment={baseUrl:"${location.origin}/vendor/monaco/"};importScripts("${vs}/base/worker/workerMain.js");`)}` };
    require.config({ paths: { vs } });
    require(["vs/editor/editor.main"], () => { monaco = window.monaco; res(); });
  });
  initEditor();
  await loadProjects();
  setPtab(S.ptab);
  const hp = new URLSearchParams(initialHash.slice(1)).get("p");
  const start = (hp && S.projects.some((x) => x.name === hp) && hp) || store.get("project") || S.projects[0]?.name;
  await setProject(start);
  // reopen previous tabs
  for (const [proj, path] of store.get("openTabs", []).slice(0, 15)) {
    if (S.projects.some((x) => x.name === proj)) await openFile(proj, path, { history: false, focus: false });
  }
  const act = store.get("activeTab");
  if (act && S.tabs.some((t) => t.key === act)) activateTab(act);
  if (initialHash.includes("f=")) await restoreFromHash(initialHash);
  if (!S.tabs.length) activateTab(null);
  renderBookmarks(); renderClips(); renderHistory();
  pollIndex();
  window.afterBoot?.();
  log("SourceWeb ready");
}
window.addEventListener("DOMContentLoaded", boot);
