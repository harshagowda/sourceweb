/* SourceWeb — SourceWeb menu fidelity.
 * Menu bar and right-click menus are generated from docs/menus.json (extracted from the SourceWeb 4
 * manual) so their order, names, separators, submenus and shortcut labels match SourceWeb one-to-one.
 * Each SourceWeb command maps onto a SourceWeb command; the few that cannot exist in a browser are shown
 * greyed out with an explanation, exactly where SourceWeb has them. */
"use strict";

// SourceWeb command name -> SourceWeb command id (when the labels differ or need a specific behaviour)
const SW_MAP = {
  "new": "newFile", "open": "openFileDialog", "open project": "openProjectDialog", "close": "closeTab", "close all": "closeAllTabs",
  "save": "saveFile", "save all": "saveAll", "save as": "saveAs", "reload file": "reloadFile", "reload as encoding": "reloadFile",
  "exit": "exitApp", "print": "printFile", "compare files": "fileCompare", "file compare": "fileCompare", "compare with backup file": "compareWithHead",
  "directory compare": "directoryCompare", "show file status": "showFileStatus", "rename file": "renameFile", "delete file": "deleteFile",
  "new window": "newWindow", "close window": "closeTab", "undo": "undo", "redo": "redo", "undo all": "undoAll", "cut": "cut", "copy": "copy", "paste": "paste",
  "delete": "deleteSel", "select all": "selectAll", "copy line": "copyLine", "cut line": "cutLine", "paste line": "pasteLine", "duplicate": "duplicateLine",
  "join lines": "joinLines", "indent left": "indentLeft", "indent right": "indentRight", "drag line up": "dragLineUp", "drag line down": "dragLineDown",
  "insert line": "insertLine", "insert line before next": "insertLine", "delete line": "deleteLine", "complete symbol": "completeSymbol",
  "complete snippet": "completeSnippet", "copy to clip": "copyToClip", "cut to clip": "cutToClip", "paste from clip": "pasteFromClip",
  "toggle case": "toggleCase", "upper case": "upperCase", "lower case": "lowerCase", "comment": "toggleComment", "uncomment": "toggleComment",
  "simple tab": "simpleTab", "restore lines": "restoreLines", "reformat source code": "formatDocument", "smart rename": "smartRename",
  "rename": "smartRename", "replace": "replace", "replace files": "replaceFiles", "search": "find", "search forward": "searchForward",
  "search backward": "searchBackward", "search forward for selection": "searchSelectionForward", "search backward for selection": "searchSelectionBackward",
  "incremental search": "incrementalSearch", "incremental search backward": "incrementalSearchBack", "search files": "searchProject",
  "search project": "searchProject", "lookup references": "lookupReferences", "search list": "browseLocalSymbols", "search web": "searchWebDisabled",
  "go to first link": "firstLink", "go to next link": "nextResult", "go to previous link": "prevResult", "jump to link": "jumpToLink",
  "go to line": "goToLine", "go to next change": "nextChange", "go to previous change": "prevChange", "go back": "goBack", "go forward": "goForward",
  "go back toggle": "goBackToggle", "jump to definition": "jumpToDefinition", "jump to caller": "jumpToCaller", "jump to base type": "jumpToBaseType",
  "jump to prototype": "jumpToPrototype", "symbol info": "symbolInfo", "browse project symbols": "browseProjectSymbols", "browse global symbols": "browseGlobalSymbols",
  "browse local file symbols": "browseLocalSymbols", "bookmark": "toggleBookmark", "selection history": "selectionHistory", "function up": "functionUp",
  "function down": "functionDown", "highlight word": "highlightWord", "clear highlights": "clearHighlights", "go to next reference highlight": "nextRefHighlight",
  "go to previous reference highlight": "prevRefHighlight", "parse source links": "parseSourceLinks", "new project": "newProject",
  "close project": "closeProject", "remove project": "removeProjectDisabled", "project settings": "projectSettings", "add and remove project files": "addRemoveFiles",
  "synchronize files": "reindexProject", "rebuild project": "reindexProject", "project report": "projectReportFile", "export project to html": "exportHtml",
  "import external symbols": "importSymbolsDisabled", "preferences": "showKeys", "key assignments": "showKeys", "menu assignments": "showMenus",
  "visual theme": "themeDialog", "load configuration": "openWorkspace", "save configuration": "saveWorkspace", "syntax decorations": "syntaxDecorations",
  "mono font view": "monoView", "full screen": "fullScreen", "browser mode": "browserMode", "line numbers": "toggleLineNumbers", "overview": "toggleMinimap",
  "symbol window": "toggleSymbolWindow", "project window": "toggleProjectWindow", "context window": "activateContext", "relation window": "activateRelation",
  "search results": "activateResults", "bookmark window": "bookmarkList", "clip window": "activateClips", "window list": "windowList",
  "activate symbol window": "activateSymbolWindow", "activate project symbol list": "activateProjectSymbolList", "activate project file list": "activateFileList",
  "activate context window": "activateContext", "activate relation window": "activateRelation", "activate search results": "activateResults",
  "activate project search bar": "activateSearchBar", "activate search bar": "activateFileSearchBar", "lock context window": "lockContext",
  "lock relation window": "lockRelation", "refresh relation window": "refreshRelation", "new relation window": "pinRelation",
  "view relation window as outline": "relViewOutline", "view relation window horizontal graph": "relViewGraph", "view relation window vertical graph": "relViewVGraph",
  "next relation window view": "relationNextView", "relation window options": "relationOptions", "expand special": "relationExpand3",
  "save layout": "saveLayoutA", "load layout": "loadLayoutA", "last window": "lastWindow", "next window": "nextTab", "previous window": "prevTab",
  "close all windows": "closeAllTabs", "save workspace": "saveWorkspace", "open workspace": "openWorkspace", "help": "showKeys", "about sourceweb": "about",
  "select block": "selectBlock", "select symbol": "selectSymbol", "select line": "selectLine", "select word": "selectWord", "select match": "selectMatch",
  "scroll line up": "scrollLineUp", "scroll line down": "scrollLineDown", "copy symbol": "copySymbol", "cut symbol": "cutSymbol", "duplicate symbol": "duplicateSymbol",
  "paste symbol": "pasteSymbol", "sort symbols by name": "symSortName", "sort symbols by line": "symSortLine", "sort symbols by type": "symSortType",
  "outline collapse": "foldAll", "outline expand": "unfoldAll", "collapse all": "foldAll", "expand all": "unfoldAll", "collapse": "fold", "expand": "unfold",
  "copy list": "copyList", "touch all files in relation": "touchDisabled", "print relation window": "printRelation", "create bookmarks from relation items": "bookmarkRelation",
  "generate call tree": "callGraph", "remove file": "removeFileDisabled", "open file": "openFileDialog",
};
// Commands SourceWeb has that cannot work in a browser tab (or would send data off the machine)
const SW_UNAVAILABLE = {
  searchWebDisabled: "Disabled on purpose: it would send code identifiers to an external website.",
  removeProjectDisabled: "Projects are the repositories on disk; remove a repository folder to remove its project.",
  importSymbolsDisabled: "The repositories' dependencies are not installed on this machine, so there is nothing to import yet.",
  touchDisabled: "Touching files changes their timestamps on disk; not offered from the browser.",
  removeFileDisabled: "Files belong to git; delete or untrack them with git.",
};

const norm = (s) => String(s || "").toLowerCase().replace(/[.…]+$/g, "").replace(/\s*\(.*\)\s*$/, "").replace(/&/g, "").trim();
function resolveCmd(item) {
  const n = norm(item.command || item.label);
  if (SW_MAP[n]) return SW_MAP[n];
  const byLabel = Object.values(COMMANDS).find((c) => norm(c.label) === n);
  return byLabel?.id || null;
}

// ------------------------------------------------------------- menu engine
let menuStack = [];
// hover only switches menus after a real mouse move (Chrome re-fires mouseenter when the DOM changes under a still pointer)
let lastPt = { x: -1, y: -1, t: 0 };
document.addEventListener("mousemove", (e) => { if (e.clientX !== lastPt.x || e.clientY !== lastPt.y) lastPt = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
let anchorPt = { x: -2, y: -2 };
const mouseMoved = () => lastPt.x !== anchorPt.x || lastPt.y !== anchorPt.y;
function closeAllMenus() { menuStack.forEach((m) => m.remove()); menuStack = []; $$("#menus > button").forEach((b) => b.classList.remove("open")); }
function showMenu(items, x, y, { level = 0, target = null, onClose } = {}) {
  anchorPt = { ...lastPt };
  if (window.expandMenuItems) items = window.expandMenuItems(items);
  menuStack.slice(level).forEach((m) => m.remove());
  menuStack = menuStack.slice(0, level);
  const el = document.createElement("div");
  el.className = "sw-menu";
  el.setAttribute("role", "menu");
  el.innerHTML = items.map((it, i) => {
    if (it.separator) return `<div class="msep"></div>`;
    const id = it.submenu ? null : (it.cmd || resolveCmd(it));
    const unavailable = !it.submenu && (!id || SW_UNAVAILABLE[id] || !COMMANDS[id]);
    const key = it.key || (id && COMMANDS[id]?.key?.split("|")[0].trim()) || "";
    const why = unavailable ? (SW_UNAVAILABLE[id] || "Not available in SourceWeb yet") : (it.doc ? `${it.command || it.label}` : "");
    return `<div class="mi ${unavailable ? "disabled" : ""} ${it.submenu ? "sub" : ""}" data-i="${i}" role="menuitem" title="${esc(why)}">
      <span class="mcheck">${it.checked?.() ? "✓" : ""}</span><span class="mlabel">${esc(it.label)}</span><span class="key">${esc(it.submenu ? "" : key)}</span><span class="marrow">${it.submenu ? "▸" : ""}</span></div>`;
  }).join("");
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(0, Math.min(x, innerWidth - r.width - 4)) + "px";
  el.style.top = Math.max(0, Math.min(y, innerHeight - r.height - 4)) + "px";
  menuStack.push(el);
  el._items = items;
  el._sel = -1;
  const open = (row) => {
    const it = items[+row.dataset.i];
    if (!it || row.classList.contains("disabled")) return;
    if (it.submenu) {
      const rr = row.getBoundingClientRect();
      return showMenu(it.submenu, rr.right - 2, rr.top - 4, { level: level + 1, target });
    }
    closeAllMenus();
    onClose?.();
    const id = it.cmd || resolveCmd(it);
    if (it.run) return it.run(target);
    if (target?.prepare) return Promise.resolve(target.prepare()).then(() => runCmd(id));
    runCmd(id);
  };
  el.querySelectorAll(".mi").forEach((row) => {
    row.onmouseenter = () => {
      if (!mouseMoved()) return;
      el.querySelectorAll(".mi").forEach((x) => x.classList.toggle("hot", x === row));
      el._sel = +row.dataset.i;
      if (items[+row.dataset.i]?.submenu && !row.classList.contains("disabled")) open(row);
      else menuStack.slice(level + 1).forEach((m) => m.remove()), (menuStack = menuStack.slice(0, level + 1));
    };
    row.onclick = (e) => { e.stopPropagation(); open(row); };
  });
  el.onmousedown = (e) => e.stopPropagation();
  el._open = open;
  return el;
}
document.addEventListener("mousedown", (e) => { if (e.button === 2 || e.target.closest?.(".sw-menu")) return; closeAllMenus(); });
window.addEventListener("blur", () => { if (!document.hasFocus()) closeAllMenus(); });
document.addEventListener("keydown", (e) => {
  if (!menuStack.length) return;
  const el = menuStack[menuStack.length - 1];
  const rows = [...el.querySelectorAll(".mi")];
  const enabled = rows.filter((r) => !r.classList.contains("disabled"));
  const cur = rows.findIndex((r) => r.classList.contains("hot"));
  const hot = (r) => { rows.forEach((x) => x.classList.toggle("hot", x === r)); r?.scrollIntoView({ block: "nearest" }); };
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); menuStack.length > 1 ? (menuStack.pop().remove()) : closeAllMenus(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); e.stopPropagation();
    const pool = enabled.length ? enabled : rows;
    let i = pool.indexOf(rows[cur]);
    i = e.key === "ArrowDown" ? (i + 1) % pool.length : (i - 1 + pool.length) % pool.length;
    hot(pool[i]);
  } else if (e.key === "ArrowRight") {
    e.preventDefault(); e.stopPropagation();
    const r = rows[cur];
    if (r?.classList.contains("sub")) el._open(r);
    else menuBarStep(1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault(); e.stopPropagation();
    if (menuStack.length > 1) menuStack.pop().remove(); else menuBarStep(-1);
  } else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (rows[cur]) el._open(rows[cur]); }
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
    // type the first letter of an item, like Windows menus
    const r = enabled.find((x) => x.querySelector(".mlabel").textContent.toLowerCase().startsWith(e.key.toLowerCase()));
    if (r) { e.preventDefault(); e.stopPropagation(); hot(r); }
  }
}, true);

// ------------------------------------------------------------- menu bar
let MENUDEF = null;
function buildSiMenuBar() {
  const nav = $("#menus");
  nav.innerHTML = "";
  const menus = [...MENUDEF.menubar.filter((m) => m.items?.length).map((m) => ({ name: m.menu, items: m.items })), { name: "SourceWeb", items: extrasMenu() }];
  menus.forEach((m, idx) => {
    const b = document.createElement("button");
    b.textContent = m.name;
    b.dataset.idx = idx;
    const openIt = () => {
      $$("#menus > button").forEach((x) => x.classList.toggle("open", x === b));
      const r = b.getBoundingClientRect();
      showMenu(m.items, r.left, r.bottom, { level: 0 });
      menuStack[0]?.classList.add("from-bar");
    };
    b.onmousedown = (e) => { e.stopPropagation(); if (b.classList.contains("open")) closeAllMenus(); else openIt(); };
    b.onclick = (e) => e.stopPropagation(); // the legacy dropdown's document click handler would clear the open state
    b.onmouseenter = () => { if (mouseMoved() && menuStack.length && $("#menus > button.open") && !b.classList.contains("open")) openIt(); };
    b._open = openIt;
    nav.append(b);
  });
}
function menuBarStep(d) {
  const bs = $$("#menus > button");
  const i = bs.findIndex((b) => b.classList.contains("open"));
  if (i < 0) return;
  bs[(i + d + bs.length) % bs.length]._open();
  const rows = [...(menuStack[0]?.querySelectorAll(".mi:not(.disabled)") || [])];
  rows[0]?.classList.add("hot");
}
// SourceWeb-only commands that have no SourceWeb counterpart live in their own menu, so the SW menus stay pure.
function extrasMenu() {
  const siIds = new Set();
  const walk = (items) => items.forEach((it) => { if (it.submenu) walk(it.submenu); else { const id = resolveCmd(it); if (id) siIds.add(id); } });
  MENUDEF.menubar.forEach((m) => walk(m.items));
  const extras = ["callGraph", "gitBranches", "showFileHistory", "toggleBlame", "fileCompare", "directoryCompare", "showFindings", "projectReport",
    "relationAuto", "relationBoth", "toggleSmartRefs", "togglePreview", "copyLink", "copyPath", "showWelcome", "themeDialog"].filter((id) => COMMANDS[id] && !siIds.has(id));
  return [{ label: "Command Palette…", cmd: "showKeys", key: "F1" }, { separator: true }, ...extras.map((id) => ({ label: COMMANDS[id].label, cmd: id }))];
}

// ---------------------------------------------------------- right-click
function ctxItems(name) { return MENUDEF?.context?.[name] || []; }
function bindContextMenus() {
  // editor: Monaco's own menu is turned off; SourceWeb's appears instead
  editor.updateOptions({ contextmenu: false });
  const edMenu = (ed, host, nameFor) => host.addEventListener("contextmenu", (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = ed.getTargetAtClientPoint(e.clientX, e.clientY);
    if (t?.position && ed.getSelection().isEmpty()) ed.setPosition(t.position);
    const MT = monaco.editor.MouseTargetType;
    const inMargin = t && [MT.GUTTER_LINE_NUMBERS, MT.GUTTER_LINE_DECORATIONS, MT.GUTTER_GLYPH_MARGIN].includes(t.type);
    showMenu(nameFor(inMargin), e.clientX, e.clientY, ed === ctxEditor ? { target: { prepare: () => ctxEditor._def && goTo(ctxEditor._def) } } : {});
  }, true);
  edMenu(editor, $("#editor"), (margin) => (margin && ctxItems("selection_bar").length ? ctxItems("selection_bar") : ctxItems("editor")));
  edMenu(ctxEditor, $("#contextEditor"), () => ctxItems("context_window"));
  const bind = (root, selector, name, prepare) => {
    document.addEventListener("contextmenu", (e) => {
      const host = e.target.closest(root);
      if (!host) return;
      e.preventDefault();
      const row = selector ? e.target.closest(selector) : null;
      host.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
      row?.classList.add("sel");
      showMenu(ctxItems(name), e.clientX, e.clientY, { target: { row, prepare: () => prepare?.(row) } });
    });
  };
  bind("#symbolList", ".row", "symbol_window", (row) => row && row.click());
  bind("#relationBody, #graphBig, [data-lpanel^=pin]", ".row, .g-node", "relation_window", (row) => row && row.dispatchEvent(new MouseEvent("dblclick")));
  bind("#resultsBody, #resultsText", ".row", "search_results", (row) => row && row.click());
  bind("#bookmarksBody", ".row", "bookmark_window", (row) => row && row.click());
  bind("#clipBody", ".row", "clip_window", null);
  bind("#diffList", ".row", "file_compare", (row) => row && row.click());
  // project window: menu depends on the active tab
  document.addEventListener("contextmenu", (e) => {
    const host = e.target.closest("#projectBody");
    if (!host) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const row = e.target.closest(".row");
    host.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
    row?.classList.add("sel");
    const name = { files: "project_file_list", psymbols: "project_symbol_list", categories: "project_symbol_list", tree: "folder_browser", workspace: "folder_browser" }[S.ptab] || "project_file_list";
    showMenu(ctxItems(name), e.clientX, e.clientY, { target: { row, prepare: () => row && row.dispatchEvent(new MouseEvent("dblclick")) } });
  }, true);
}

// --------------------------------------- commands needed by SourceWeb menus
function regSiCommands() {
  const ed = (a) => () => editor.getAction(a)?.run();
  cmd("newFile", "New", async () => {
    const name = prompt(`New file in ${S.project} (path relative to the repository):`, "untitled.py");
    if (!name) return;
    await api(`/api/projects/${encodeURIComponent(S.project)}/file?${q({ path: name })}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "" }) });
    S.files = await api(`/api/projects/${encodeURIComponent(S.project)}/files`); renderProjectPane();
    openFile(S.project, name);
  }, "Ctrl+N");
  cmd("saveAs", "Save As…", async () => {
    const t = activeTab(); if (!t) return;
    const name = prompt("Save as (path relative to the repository):", t.path);
    if (!name || name === t.path) return;
    await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: name })}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: t.model.getValue() }) });
    S.files = await api(`/api/projects/${encodeURIComponent(t.project)}/files`); renderProjectPane();
    openFile(t.project, name);
  });
  cmd("exitApp", "Exit", () => { if (confirm("Close SourceWeb in this tab?")) window.close(); });
  cmd("printFile", "Print…", () => { const t = activeTab(); if (!t) return; const w = window.open("", "_blank"); w.document.write(`<title>${esc(t.path)}</title><pre style="font:11px monospace">${esc(t.model.getValue())}</pre>`); w.document.close(); w.print(); });
  cmd("showFileStatus", "Show File Status", () => { const t = activeTab(); if (!t) return; toast(`${t.project}/${t.path} — ${t.model.getLineCount()} lines, ${t.model.getValueLength()} chars, ${t.dirty ? "modified" : "saved"}, ${t.model.getLanguageId()}`, 5000); });
  cmd("renameFile", "Rename File…", () => toast("Rename files with git mv; SourceWeb picks the change up automatically"));
  cmd("deleteFile", "Delete File…", () => toast("Delete files with git rm; SourceWeb picks the change up automatically"));
  cmd("newWindow", "New Window", () => window.open(location.href, "_blank"));
  cmd("undoAll", "Undo All", () => { const t = activeTab(); if (t && confirm("Undo all changes since the file was opened?")) { while (t.model.canUndo()) t.model.undo(); } });
  cmd("cut", "Cut", () => { editor.focus(); document.execCommand("cut"); }, "Ctrl+X");
  cmd("copy", "Copy", () => { editor.focus(); document.execCommand("copy"); }, "Ctrl+C");
  cmd("paste", "Paste", async () => { editor.focus(); try { const t = await navigator.clipboard.readText(); editor.executeEdits("paste", [{ range: editor.getSelection(), text: t, forceMoveMarkers: true }]); } catch { toast("Use Ctrl+V to paste"); } }, "Ctrl+V");
  cmd("deleteSel", "Delete", () => editor.executeEdits("del", [{ range: editor.getSelection(), text: "" }]));
  cmd("selectAll", "Select All", ed("editor.action.selectAll"), "Ctrl+A");
  cmd("pasteLine", "Paste Line", async () => { try { const t = await navigator.clipboard.readText(); const ln = editor.getPosition().lineNumber; editor.executeEdits("pl", [{ range: new monaco.Range(ln, 1, ln, 1), text: t.endsWith("\n") ? t : t + "\n" }]); } catch { toast("Clipboard not available"); } });
  cmd("insertLine", "Insert Line", ed("editor.action.insertLineAfter"));
  cmd("completeSymbol", "Complete Symbol", ed("editor.action.triggerSuggest"), "Ctrl+Space");
  cmd("completeSnippet", "Complete Snippet", ed("editor.action.triggerSuggest"), "Ctrl+E");
  cmd("toggleCase", "Toggle Case", () => { const s = editor.getSelection(); const t = editor.getModel().getValueInRange(s); editor.executeEdits("case", [{ range: s, text: [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("") }]); });
  cmd("upperCase", "Upper Case", ed("editor.action.transformToUppercase"));
  cmd("lowerCase", "Lower Case", ed("editor.action.transformToLowercase"));
  cmd("simpleTab", "Simple Tab", () => editor.trigger("menu", "type", { text: "\t" }));
  cmd("restoreLines", "Restore Lines", async () => {
    const t = activeTab(); if (!t) return;
    const sel = editor.getSelection();
    const head = await api(`/api/projects/${encodeURIComponent(t.project)}/file?${q({ path: t.path, rev: "HEAD" })}`).catch(() => null);
    if (head == null) return toast("No committed version to restore from");
    const lines = head.split("\n").slice(sel.startLineNumber - 1, sel.endLineNumber);
    editor.executeEdits("restore", [{ range: new monaco.Range(sel.startLineNumber, 1, sel.endLineNumber, t.model.getLineMaxColumn(sel.endLineNumber)), text: lines.join("\n") }]);
    toast("Lines restored from the last commit (undoable)");
  });
  cmd("searchSelectionBackward", "Search Backward For Selection", ed("editor.action.previousSelectionMatchFindAction"), "Shift+F3");
  cmd("newProject", "New Project…", () => toast("Each folder under the workspace is a project — clone a repository there and it appears automatically after a restart"));
  cmd("closeProject", "Close Project", () => { [...S.tabs].filter((t) => t.project === S.project && !t.dirty).forEach((t) => closeTab(t.key)); activateTab(null); });
  cmd("projectSettings", "Project Settings…", () => setPtab("report"));
  cmd("addRemoveFiles", "Add and Remove Project Files…", () => toast("Project files are the repository's git-tracked files; add or remove them with git"));
  cmd("showMenus", "Menu Assignments…", () => { const out = []; MENUDEF.menubar.forEach((m) => { out.push(`${m.menu}`); const w = (items, d) => items.forEach((it) => { if (it.separator) return; const id = it.submenu ? "" : resolveCmd(it); out.push(`${"    ".repeat(d)}${it.label}${it.submenu ? "  ▸" : `   → ${id && COMMANDS[id] ? COMMANDS[id].label : "(n/a)"}`}`); if (it.submenu) w(it.submenu, d + 1); }); w(m.items, 1); }); showTextTab("Menu Assignments", out.join("\n")); });
  cmd("toggleLineNumbers", "Line Numbers", () => { const on = editor.getOption(monaco.editor.EditorOption.lineNumbers).renderType !== 0; editor.updateOptions({ lineNumbers: on ? "off" : "on" }); });
  cmd("activateClips", "Clip Window", () => setLtab("clip"));
  cmd("lockContext", "Lock Context Window", () => $("#contextLock").click());
  cmd("lockRelation", "Lock Relation Window", () => $("#relationLock").click());
  cmd("refreshRelation", "Refresh Relation Window", () => updateRelation(true));
  cmd("relViewOutline", "View Relation Window as Outline", () => { $("#relationView").value = "outline"; store.set("relView", "outline"); redrawRelation(); });
  cmd("relViewGraph", "View Relation Window as Horizontal Graph", () => { $("#relationView").value = "graph"; store.set("relView", "graph"); redrawRelation(); });
  cmd("relViewVGraph", "View Relation Window as Vertical Graph", () => { $("#relationView").value = "vgraph"; store.set("relView", "vgraph"); redrawRelation(); });
  cmd("relationOptions", "Relation Window Options…", () => { setLtab("relation"); $("#relationMode").focus(); });
  cmd("relationExpand3", "Expand Special", () => { S.relLevels = 3; $("#relationLevels").value = "3"; updateRelation(true); });
  cmd("selectLine", "Select Line", () => { const ln = editor.getPosition().lineNumber; editor.setSelection(new monaco.Selection(ln, 1, ln + 1, 1)); }, "Shift+F6");
  cmd("selectWord", "Select Word", () => { const w = editor.getModel().getWordAtPosition(editor.getPosition()); if (w) { const ln = editor.getPosition().lineNumber; editor.setSelection(new monaco.Selection(ln, w.startColumn, ln, w.endColumn)); } }, "Shift+F5");
  cmd("selectMatch", "Select Match", ed("editor.action.selectToBracket"));
  const symAtRow = () => S.symbols[+($("#symbolList .row.sel")?.dataset.i ?? -1)] || symbolAtLine(editor.getPosition().lineNumber);
  const symText = (s) => editor.getModel().getValueInRange(new monaco.Range(s.line, 1, (s.end || s.line) + 1, 1));
  cmd("copySymbol", "Copy Symbol", () => { const s = symAtRow(); if (!s) return; navigator.clipboard?.writeText(symText(s)); S.symClip = symText(s); toast(`Copied ${s.name}`); });
  cmd("cutSymbol", "Cut Symbol", () => { const s = symAtRow(); if (!s) return; S.symClip = symText(s); navigator.clipboard?.writeText(S.symClip); editor.executeEdits("cutsym", [{ range: new monaco.Range(s.line, 1, (s.end || s.line) + 1, 1), text: "" }]); });
  cmd("duplicateSymbol", "Duplicate Symbol", () => { const s = symAtRow(); if (!s) return; const txt = symText(s); editor.executeEdits("dupsym", [{ range: new monaco.Range((s.end || s.line) + 1, 1, (s.end || s.line) + 1, 1), text: "\n" + txt }]); });
  cmd("pasteSymbol", "Paste Symbol", () => { if (!S.symClip) return toast("No symbol copied"); const ln = editor.getPosition().lineNumber; editor.executeEdits("pastesym", [{ range: new monaco.Range(ln, 1, ln, 1), text: S.symClip }]); });
  cmd("symSortName", "Sort Symbols by Name", () => $('#symSortBtns [data-sort=name]').click());
  cmd("symSortLine", "Sort Symbols by Line", () => $('#symSortBtns [data-sort=line]').click());
  cmd("symSortType", "Sort Symbols by Type", () => $('#symSortBtns [data-sort=type]').click());
  cmd("foldAll", "Collapse All", ed("editor.foldAll"));
  cmd("unfoldAll", "Expand All", ed("editor.unfoldAll"));
  cmd("fold", "Collapse", ed("editor.fold"));
  cmd("unfold", "Expand", ed("editor.unfold"));
  cmd("copyList", "Copy List", () => { const host = [...document.querySelectorAll(".lpanel.active .list, #projectBody, #symbolList")].find((x) => x.offsetParent); navigator.clipboard?.writeText([...(host?.querySelectorAll(".row") || [])].map((r) => r.innerText.replace(/\s+/g, " ").trim()).join("\n")); toast("List copied"); });
  cmd("printRelation", "Print Relation Window", () => { const svg = $("#relationBody svg"); const w = window.open("", "_blank"); w.document.write(svg ? svg.outerHTML : $("#relationBody").innerHTML); w.document.close(); w.print(); });
  cmd("bookmarkRelation", "Create Bookmarks from Relation Items", () => { const add = (n) => { if (n.path && (n.hitLine || n.line)) S.bookmarks.push({ project: n.project, path: n.path, line: n.hitLine || n.line, col: 1, label: n.name || n.label, text: "" }); (n.children || []).forEach(add); }; if (S.relTree) (S.relTree.children || []).forEach(add); store.set("bookmarks", S.bookmarks); renderBookmarks(); setLtab("bookmarks"); });
  cmd("about", "About SourceWeb", () => toast("SourceWeb (Sw) — a symbol-aware code browser running locally on this machine", 5000));
  for (const id of Object.keys(SW_UNAVAILABLE)) cmd(id, "(unavailable)", () => toast(SW_UNAVAILABLE[id], 6000));
}

const _v1 = window.extendCommands, _v2 = window.extendEditor, _v3 = window.afterBoot;
window.extendCommands = function () { _v1?.(); regSiCommands(); };
window.extendEditor = function () { _v2?.(); };
window.afterBoot = async function () {
  await _v3?.();
  try { MENUDEF = await api("/api/menus"); } catch { MENUDEF = null; }
  if (MENUDEF?.menubar?.length) {
    buildSiMenuBar();
    // the old dropdown is superseded by the SourceWeb menu engine
    window.openMenu = (name, btn) => btn?._open?.();
    document.removeEventListener("click", closeMenu); // retire the legacy dropdown's close-on-click
  }
  bindContextMenus();
};
