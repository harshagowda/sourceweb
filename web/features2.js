/* SourceWeb — batches D (search) and E (data & session) of docs/SPEC.md. Chains onto features.js hooks. */
"use strict";

// --------------------------------------------------------- search history
S.searchSets = [];   // [{title, hits, truncated, word}] — SW appends each search to the Search Results window
const _showResults = window.showResults;
window.showResults = function (title, hits, opts = {}) {
  if (!opts._fromHistory) {
    S.searchSets.unshift({ title, hits, ...opts });
    S.searchSets = S.searchSets.slice(0, 30);
  }
  _showResults(title, hits, opts);
  decorateResults(hits);
  renderResultsBar();
  if (S.resultsView === "text") renderResultsBuffer();
};
function decorateResults(hits) {
  // show the containing function next to each result line (SW "include container name")
  $$("#resultsBody .row[data-i]").forEach((r) => {
    const h = hits[+r.dataset.i];
    if (h?.fn && !r.querySelector(".fn")) r.querySelector(".right").insertAdjacentHTML("afterend", `<span class="fn">${esc(h.fn)}</span>`);
  });
}
S.resultsView = store.get("resultsView", "list");
function renderResultsBar() {
  let bar = $("#resultsBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "resultsBar";
    bar.className = "pane-head";
    $('[data-lpanel="results"]').prepend(bar);
  }
  bar.innerHTML = `<select id="resultsHistory" title="Previous searches">${S.searchSets.map((s, i) => `<option value="${i}">${esc(s.title)} (${s.hits.length})</option>`).join("")}</select>
    <span class="spacer"></span>
    <button class="mini ${S.resultsView === "list" ? "on" : ""}" data-v="list" title="List view">List</button>
    <button class="mini ${S.resultsView === "text" ? "on" : ""}" data-v="text" title="Text buffer view with source links (Ctrl+L on a line)">Text</button>
    <button class="mini" id="resultsClear" title="Clear all results">Clear</button>`;
  $("#resultsHistory").onchange = (e) => { const s = S.searchSets[+e.target.value]; showResults(s.title, s.hits, { ...s, _fromHistory: true }); $("#resultsHistory").value = e.target.value; };
  bar.querySelectorAll("button[data-v]").forEach((b) => (b.onclick = () => { S.resultsView = b.dataset.v; store.set("resultsView", S.resultsView); renderResultsBar(); S.resultsView === "text" ? renderResultsBuffer() : hideResultsBuffer(); }));
  $("#resultsClear").onclick = () => { S.searchSets = []; results = []; $("#resultsBody").innerHTML = ""; $("#resultsCount").textContent = ""; renderResultsBar(); hideResultsBuffer(); };
}

// Text buffer view: a real editable Monaco buffer in SW's format, each line linked to its source.
let resultsEditor = null;
function renderResultsBuffer() {
  const host = $('[data-lpanel="results"]');
  let div = $("#resultsText");
  if (!div) { div = document.createElement("div"); div.id = "resultsText"; host.append(div); }
  div.hidden = false;
  $("#resultsBody").style.display = "none";
  const lines = [], links = [];
  for (const set of S.searchSets.slice().reverse()) {
    lines.push(`---- ${set.title} (${set.hits.length}) ----`); links.push(null);
    for (const h of set.hits) {
      lines.push(`${h.project}/${h.path} (${h.line})${h.fn ? " " + h.fn : ""}: ${h.text.trim()}`);
      links.push(h);
    }
  }
  if (!resultsEditor) {
    resultsEditor = monaco.editor.create(div, { value: "", language: "sw-results", automaticLayout: true, minimap: { enabled: false }, lineNumbers: "off", fontSize: 12, wordWrap: "off", theme: document.documentElement.dataset.theme === "dark" ? "sw-dark" : "sw-light" });
    resultsEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => jumpBufferLink());
    resultsEditor.onMouseDown((e) => { if (e.event.detail === 2) setTimeout(jumpBufferLink, 0); });
  }
  resultsEditor._links = links;
  resultsEditor.setValue(lines.join("\n"));
  resultsEditor.revealLine(lines.length);
}
function jumpBufferLink() {
  const ln = resultsEditor.getPosition().lineNumber;
  // a line may have been edited; parse "project/path (line)" from the text so links survive edits
  const txt = resultsEditor.getModel().getLineContent(ln);
  const m = txt.match(/^([\w.-]+)\/(.+?) \((\d+)\)/);
  if (m) return goTo({ project: m[1], path: m[2], line: +m[3] }, { focus: false });
  const h = resultsEditor._links?.[ln - 1];
  if (h) goTo({ project: h.project, path: h.path, line: h.line }, { focus: false });
}
function hideResultsBuffer() { const d = $("#resultsText"); if (d) d.hidden = true; $("#resultsBody").style.display = ""; }

// ------------------------------------------------- lookup references (opts)
S.refOpts = store.get("refOpts", { case: true, word: true, skip_comments: false, glob: "", workspace: false });
window.lookupReferences = async function (workspace = false, name = wordAtCursor()) {
  const t = activeTab();
  if (!name) return toast("Put the cursor on a symbol");
  toast(`Looking up references to ${name}…`);
  const o = { ...S.refOpts, workspace: workspace || S.refOpts.workspace };
  const r = await api(`/api/projects/${encodeURIComponent(t?.project || S.project)}/references2?${q({ name, ...o })}`);
  showResults(`References to ${name}${o.workspace ? " (all projects)" : ""}`, r.hits, { truncated: r.truncated, word: name });
  log(`references ${name}: ${r.hits.length}`);
};
function lookupReferencesDialog() {
  const o = S.refOpts;
  palette({
    title: "Lookup References", value: wordAtCursor() || "", placeholder: "symbol name",
    optionsHtml: `<label><input type="checkbox" id="rCase" ${o.case ? "checked" : ""}> Case sensitive</label>
      <label><input type="checkbox" id="rWord" ${o.word ? "checked" : ""}> Whole words only</label>
      <label><input type="checkbox" id="rSkip" ${o.skip_comments ? "checked" : ""}> Skip comments</label>
      <label><input type="checkbox" id="rAll" ${o.workspace ? "checked" : ""}> All projects</label>
      <label>File types <input id="rGlob" value="${esc(o.glob)}" placeholder="*.py,*.ts" style="width:120px"></label>`,
    items: [], empty: "Enter to search", render: () => "", pick: () => {},
    pickText: (v) => v && lookupReferences(false, v),
  });
  const pt = pal.pickText;
  pal.pickText = (v) => {
    S.refOpts = { case: $("#rCase").checked, word: $("#rWord").checked, skip_comments: $("#rSkip").checked, glob: $("#rGlob").value, workspace: $("#rAll").checked };
    store.set("refOpts", S.refOpts);
    pt(v);
  };
}

// ------------------------------------------- search project: keyword mode
window.searchProject = function (scopeAll = false) {
  const t = activeTab();
  const sel = editor?.getModel() ? editor.getModel().getValueInRange(editor.getSelection()) : "";
  const last = store.get("lastSearch", { mode: "simple", regex: false, case: false, word: false, glob: "", all: false, context: 0, fragments: true });
  palette({
    title: "Search Project", placeholder: "text, regex, or keyword expression (a b = AND, a OR b, -x / NOT x, =Case, ?\"regex\")",
    value: sel && !sel.includes("\n") ? sel : (wordAtCursor() || ""),
    optionsHtml: `<label>Method <select id="sMode"><option value="simple">Simple string</option><option value="regex">Regular expression</option><option value="keyword">Keyword expression</option></select></label>
      <label><input type="checkbox" id="sCase" ${last.case ? "checked" : ""}> Case sensitive</label>
      <label><input type="checkbox" id="sWord" ${last.word ? "checked" : ""}> Whole words</label>
      <label title="Keyword mode: all terms must occur within this many lines">Lines of context <input id="sCtx" type="number" min="0" max="50" value="${last.context || 0}" style="width:48px"></label>
      <label title="Keyword mode: match fragments inside identifiers"><input type="checkbox" id="sFrag" ${last.fragments !== false ? "checked" : ""}> Word fragments</label>
      <label><input type="checkbox" id="sAll" ${scopeAll || last.all ? "checked" : ""}> All projects</label>
      <label>Files <input id="sGlob" value="${esc(last.glob || "")}" placeholder="*.py,!tests/**" style="width:130px"></label>`,
    items: [], empty: "Press Enter to search", hint: "Enter search · results → Search Results (Shift+F9 / Shift+F8 next/prev, Ctrl+L jump)",
    render: () => "", pick: () => {},
  });
  $("#sMode").value = last.mode || (last.regex ? "regex" : "simple");
  pal.pickText = async (v) => {
    if (!v) return;
    const o = { mode: $("#sMode").value, case: $("#sCase").checked, word: $("#sWord").checked, glob: $("#sGlob").value, all: $("#sAll").checked, context: +$("#sCtx").value || 0, fragments: $("#sFrag").checked };
    o.regex = o.mode === "regex";
    store.set("lastSearch", o);
    toast(`Searching for ${v}…`);
    try {
      const project = o.all ? undefined : (t?.project || S.project);
      const r = o.mode === "keyword"
        ? await api(`/api/ksearch?${q({ q: v, project, context: o.context, fragments: o.fragments, glob: o.glob })}`)
        : await api(`/api/search?${q({ q: v, project, regex: o.regex, case: o.case, word: o.word, glob: o.glob })}`);
      showResults(`Search "${v}"`, r.hits, { truncated: r.truncated });
    } catch (e) { toast(`Search failed: ${e.message}`); }
  };
};

// ------------------------------------------------------------ Replace Files
function replaceFilesDialog() {
  const t = activeTab();
  const last = store.get("lastReplace", { find: wordAtCursor() || "", replace: "", regex: false, case: true, word: true, preserve_case: false, glob: "" });
  palette({
    title: `Replace Files — ${t?.project || S.project}`, value: last.find, placeholder: "find…",
    optionsHtml: `<label>Replace with <input id="xRepl" value="${esc(last.replace)}" style="width:180px"></label>
      <label><input type="checkbox" id="xRegex" ${last.regex ? "checked" : ""}> Regex</label>
      <label><input type="checkbox" id="xCase" ${last.case ? "checked" : ""}> Case sensitive</label>
      <label><input type="checkbox" id="xWord" ${last.word ? "checked" : ""}> Whole words</label>
      <label><input type="checkbox" id="xPres" ${last.preserve_case ? "checked" : ""}> Preserve old case</label>
      <label>Files <input id="xGlob" value="${esc(last.glob)}" placeholder="*.py" style="width:100px"></label>`,
    items: [], empty: "Enter = preview the files that would change; then confirm", render: () => "", pick: () => {},
  });
  pal.pickText = async (find) => {
    const body = { project: t?.project || S.project, find, replace: $("#xRepl").value, regex: $("#xRegex").checked, case: $("#xCase").checked, word: $("#xWord").checked, preserve_case: $("#xPres").checked, glob: $("#xGlob").value };
    store.set("lastReplace", { ...body });
    const dry = await api("/api/replace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, dry_run: true }) });
    if (!dry.total) return toast("No matches");
    const dirtyOpen = S.tabs.filter((x) => x.dirty && dry.files.some((f) => f.path === x.path && x.project === body.project));
    if (dirtyOpen.length) return toast(`Save or revert open files first: ${dirtyOpen.map((x) => x.path).join(", ")}`, 6000);
    if (!confirm(`Replace ${dry.total} occurrence(s) in ${dry.files.length} file(s)?\n\n${dry.files.slice(0, 30).map((f) => `${f.path} (${f.count})`).join("\n")}`)) return;
    const res = await api("/api/replace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, dry_run: false }) });
    toast(`Replaced ${res.total} in ${res.files.length} file(s)`);
    log(`replace files "${find}" → "${body.replace}": ${res.total} in ${res.files.length} files`);
    showResults(`Replaced "${find}" → "${body.replace}"`, res.files.map((f) => ({ project: body.project, path: f.path, line: 1, text: `${f.count} replacement(s)` })));
    await reloadOpenTabs(body.project, res.files.map((f) => f.path));
    loadNames();
  };
}
async function reloadOpenTabs(project, paths) {
  for (const t of S.tabs.filter((x) => x.project === project && paths.includes(x.path) && !x.rev && !x.dirty)) {
    try {
      const txt = await api(`/api/projects/${encodeURIComponent(project)}/file?${q({ path: t.path })}`);
      if (txt === t.model.getValue()) continue;
      const view = t.key === S.active ? editor.saveViewState() : null;
      t.model.setValue(txt);
      t.savedVersion = t.model.getAlternativeVersionId();
      t.dirty = false;
      if (view) editor.restoreViewState(view);
    } catch { /* deleted */ }
  }
  renderTabs();
  if (activeTab() && paths.includes(activeTab().path)) loadFileSymbols();
}

// -------------------------------------------------- external file changes
S.changesSince = Date.now() / 1000;
async function pollChanges() {
  try {
    const r = await api(`/api/changes?since=${S.changesSince}`);
    S.changesSince = r.now;
    const byProj = {};
    for (const c of r.changes) (byProj[c.project] ||= []).push(c.path);
    for (const [proj, paths] of Object.entries(byProj)) {
      const conflicted = S.tabs.filter((t) => t.project === proj && t.dirty && paths.includes(t.path));
      conflicted.forEach((t) => toast(`${t.path} changed on disk while you have unsaved edits`, 6000));
      await reloadOpenTabs(proj, paths);
      if (proj === S.project) { S.files = await api(`/api/projects/${encodeURIComponent(proj)}/files`); loadNames(); }
      log(`synchronized ${paths.length} changed file(s) in ${proj}`);
    }
  } catch { /* server restarting */ }
  setTimeout(pollChanges, 4000);
}

// ------------------------------------------- symbol-relative bookmarks
// Each bookmark remembers the enclosing symbol and the line offset from it, so it survives edits above it.
const _toggleBookmark = window.toggleBookmark;
window.toggleBookmark = function () {
  const n = S.bookmarks.length;
  _toggleBookmark();
  if (S.bookmarks.length > n) {
    const b = S.bookmarks[S.bookmarks.length - 1];
    const s = symbolAtLine(b.line);
    if (s) { b.symbol = s.name; b.offset = b.line - s.line; }
    store.set("bookmarks", S.bookmarks);
    saveSessionSoon();
  }
};
function rebaseBookmarks() {
  const t = activeTab();
  if (!t) return;
  let moved = false;
  for (const b of S.bookmarks.filter((b) => b.project === t.project && b.path === t.path && b.symbol)) {
    const s = S.symbols.find((x) => x.name === b.symbol);
    if (s && s.line + b.offset !== b.line) { b.line = s.line + b.offset; moved = true; }
  }
  if (moved) { store.set("bookmarks", S.bookmarks); renderBookmarks(); decorateBookmarks(); }
}
const _loadFileSymbols = window.loadFileSymbols;
window.loadFileSymbols = async function () { await _loadFileSymbols(); rebaseBookmarks(); };
const _renderBookmarks = window.renderBookmarks;
window.renderBookmarks = function () {
  _renderBookmarks();
  const body = $("#bookmarksBody");
  body.insertAdjacentHTML("afterbegin", `<div class="pane-head"><input id="bmInput" class="pane-filter" placeholder="Bookmark name — Enter jumps to an existing one or creates a new one here"></div>`);
  $("#bmInput").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const name = e.target.value.trim();
    const hit = S.bookmarks.find((b) => b.label.toLowerCase() === name.toLowerCase());
    if (hit) return goTo(hit);
    const loc = currentLocation();
    if (!loc) return toast("Open a file first");
    const label = name || String.fromCharCode(97 + (S.bookmarks.length % 26)); // SW auto-assigns a letter
    const s = symbolAtLine(loc.line);
    S.bookmarks.push({ ...loc, label, text: editor.getModel().getLineContent(loc.line).trim().slice(0, 120), symbol: s?.name, offset: s ? loc.line - s.line : 0 });
    store.set("bookmarks", S.bookmarks);
    renderBookmarks(); decorateBookmarks(); saveSessionSoon();
  };
};

// ------------------------------------------------------ workspace / session
function sessionSnapshot() {
  const tabs = S.tabs.filter((t) => !t.rev).map((t) => {
    const view = t.key === S.active ? editor.saveViewState() : t.view;
    const pos = view?.cursorState?.[0]?.position || { lineNumber: 1, column: 1 };
    return { project: t.project, path: t.path, line: pos.lineNumber, col: pos.column };
  });
  return {
    v: 1, saved: new Date().toISOString(), project: S.project, active: S.active, tabs,
    history: S.history.slice(-100), bookmarks: S.bookmarks, clips: S.clips, highlights: S.highlights,
    lastSearch: store.get("lastSearch", null), refOpts: S.refOpts, layout: layoutSnapshot(),
    relMode: $("#relationMode")?.value, relLevels: S.relLevels, ptab: S.ptab,
  };
}
async function applySession(ws) {
  if (!ws) return;
  if (ws.project) await setProject(ws.project);
  S.bookmarks = ws.bookmarks || S.bookmarks; store.set("bookmarks", S.bookmarks);
  S.clips = ws.clips || S.clips; store.set("clips", S.clips);
  S.highlights = ws.highlights || [];
  if (ws.lastSearch) store.set("lastSearch", ws.lastSearch);
  if (ws.layout) applyLayout(ws.layout);
  if (ws.relMode) $("#relationMode").value = ws.relMode;
  for (const t of ws.tabs || []) await openFile(t.project, t.path, { line: t.line, col: t.col, history: false, focus: false });
  if (ws.active && S.tabs.some((t) => t.key === ws.active)) activateTab(ws.active);
  S.history = ws.history || S.history; S.histIdx = S.history.length - 1;
  renderBookmarks(); renderClips(); renderHistory(); decorateBookmarks();
}
const saveSessionSoon = debounce(() => {
  const snap = sessionSnapshot();
  api(`/api/state/workspaces/${encodeURIComponent(S.workspaceName)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(snap) }).catch(() => {});
}, 2500);
// ?ws=name selects a named workspace for this tab (also keeps automated tests out of the user's session)
const SW_INITIAL_HASH = location.hash;
S.workspaceName = new URLSearchParams(location.search).get("ws") || store.get("workspaceName", "default");
async function saveWorkspaceAs() {
  const name = prompt("Save workspace as:", S.workspaceName);
  if (!name || !/^[\w .-]{1,60}$/.test(name)) return;
  S.workspaceName = name; store.set("workspaceName", name);
  await api(`/api/state/workspaces/${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(sessionSnapshot()) });
  toast(`Workspace "${name}" saved (available on every device)`);
}
async function openWorkspaceDialog() {
  const list = await api("/api/state/workspaces");
  palette({
    title: "Open Workspace", items: list, filter: (w, v) => w.name.toLowerCase().includes(v.toLowerCase()),
    render: (w) => `🗂 <span>${esc(w.name)}</span><span class="right">${new Date(w.mtime * 1000).toLocaleString()}</span>`,
    pick: async (w) => {
      S.workspaceName = w.name; store.set("workspaceName", w.name);
      [...S.tabs].forEach((t) => { if (!t.dirty) closeTab(t.key); });
      await applySession(await api(`/api/state/workspaces/${encodeURIComponent(w.name)}`));
      toast(`Workspace "${w.name}" opened`);
    },
    hint: "Workspaces are stored on the server — open the same session from any device",
  });
}

// --------------------------------------------------------------- layouts
const LAYOUT_VARS = ["--symbol-w", "--project-w", "--bottom-h", "--context-w"];
function layoutSnapshot() {
  const cs = document.documentElement.style;
  return { vars: Object.fromEntries(LAYOUT_VARS.map((v) => [v, cs.getPropertyValue(v)]).filter(([, x]) => x)), hidden: ["#symbolPane", "#projectPane", "#bottom"].filter((s) => $(s)?.style.display === "none") };
}
function applyLayout(l) {
  for (const [k, v] of Object.entries(l.vars || {})) document.documentElement.style.setProperty(k, v);
  for (const s of ["#symbolPane", "#projectPane", "#bottom"]) {
    const el = $(s); if (!el) continue;
    const hide = (l.hidden || []).includes(s);
    el.style.display = hide ? "none" : "";
    const v = { "#symbolPane": "--symbol-w", "#projectPane": "--project-w", "#bottom": "--bottom-h" }[s];
    if (hide) document.documentElement.style.setProperty(v, "0px");
  }
  setTimeout(() => { editor.layout(); ctxEditor.layout(); }, 0);
}
async function saveLayout(slot) {
  await api(`/api/state/layouts/${slot}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(layoutSnapshot()) });
  toast(`Layout ${slot} saved`);
}
async function loadLayout(slot) {
  try { applyLayout(await api(`/api/state/layouts/${slot}`)); toast(`Layout ${slot}`); }
  catch { toast(`Layout ${slot} is empty — use View ▸ Save Layout ${slot}`); }
}

// ------------------------------------------------------------- hooks
const _ext1 = window.extendCommands, _ext2 = window.extendEditor, _ext3 = window.afterBoot;
window.extendCommands = function () {
  _ext1?.();
  cmd("lookupReferencesDialog", "Lookup References…", lookupReferencesDialog, "Ctrl+Alt+/");
  cmd("replaceFiles", "Replace Files…", replaceFilesDialog, "Ctrl+Shift+H");
  cmd("incrementalSearch", "Incremental Search", () => editor.getAction("actions.find").run(), "F12");
  cmd("incrementalSearchBack", "Incremental Search Backward", () => { editor.getAction("actions.find").run(); editor.getAction("editor.action.previousMatchFindAction").run(); }, "Shift+F12");
  cmd("jumpToDefinition", "Jump To Definition", () => jumpToDefinition(), "Alt+= | Ctrl+=");
  cmd("lookupReferences", "Lookup References", () => lookupReferences(false), "Ctrl+/");
  cmd("saveWorkspace", "Save Workspace As…", saveWorkspaceAs);
  cmd("openWorkspace", "Open Workspace…", openWorkspaceDialog);
  for (const s of ["A", "B", "C", "D"]) {
    cmd(`saveLayout${s}`, `Save Layout ${s}`, () => saveLayout(s));
    cmd(`loadLayout${s}`, `Layout ${s}`, () => loadLayout(s), `Ctrl+Alt+${"ABCD".indexOf(s) + 1}`);
  }
  MENUS.Search.splice(MENUS.Search.indexOf("lookupReferences") + 1, 0, "lookupReferencesDialog");
  MENUS.Search.splice(MENUS.Search.indexOf("smartRename") + 1, 0, "replaceFiles", "incrementalSearch");
  MENUS.Project.push("-", "openWorkspace", "saveWorkspace");
  MENUS.View.push("-", "loadLayoutA", "loadLayoutB", "loadLayoutC", "loadLayoutD", "saveLayoutA", "saveLayoutB", "saveLayoutC", "saveLayoutD");
};
window.extendEditor = function () {
  _ext2?.();
  editor.addCommand(monaco.KeyCode.F12, () => runCmd("incrementalSearch"));
  monaco.languages.register({ id: "sw-results" });
  monaco.languages.setMonarchTokensProvider("sw-results", { tokenizer: { root: [[/^----.*----$/, "keyword"], [/^[\w.-]+\/[^ ]+ \(\d+\)/, "type"], [/ [A-Za-z_]\w*:/, "string"]] } });
  editor.onDidChangeCursorPosition(() => saveSessionSoon());
};
window.afterBoot = async function () {
  _ext3?.();
  // A device with no local session (phone, other laptop) picks up the server-side workspace.
  // a deep link (#p=…&f=…) always wins over the saved session
  if (!store.get("openTabs", []).length && !/[#&](f|p)=/.test(SW_INITIAL_HASH)) {
    try { await applySession(await api(`/api/state/workspaces/${encodeURIComponent(S.workspaceName)}`)); } catch { /* none yet */ }
  }
  renderBookmarks();
  renderResultsBar();
  pollChanges();
};
