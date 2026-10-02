/* SourceWeb — Smart Reference Matching for Python (jedi on the server): exact references, import-following
 * Jump To Definition and Context window. Falls back to the text index when unavailable. */
"use strict";

const isPy = (t) => t && /\.pyi?$/.test(t.path);
S.refOpts.smart = S.refOpts.smart ?? true;

async function smartDefAtCursor() {
  const t = activeTab();
  const pos = editor.getPosition();
  if (!isPy(t) || !pos) return [];
  try { return await api(`/api/projects/${encodeURIComponent(t.project)}/smartdef?${q({ path: t.path, line: pos.lineNumber, col: pos.column })}`); }
  catch { return []; }
}

const _jtd5 = window.jumpToDefinition;
window.jumpToDefinition = async function (name) {
  if (name === undefined && isPy(activeTab())) {
    const defs = await smartDefAtCursor();
    const cur = currentLocation();
    const d = defs.find((x) => !(x.path === cur.path && x.line === cur.line));
    if (d) return goTo(d);
  }
  return _jtd5(name);
};

const _lr5 = window.lookupReferences;
window.lookupReferences = async function (workspace = false, name) {
  const t = activeTab();
  if (!workspace && name === undefined && isPy(t) && S.refOpts.smart && !S.refOpts.workspace) {
    const pos = editor.getPosition();
    try {
      const r = await api(`/api/projects/${encodeURIComponent(t.project)}/smartrefs?${q({ path: t.path, line: pos.lineNumber, col: pos.column })}`);
      if (r.hits.length) {
        showResults(`References to ${r.name} (smart)`, r.hits, { word: r.name });
        log(`smart references ${r.name}: ${r.hits.length}`);
        return;
      }
    } catch { /* fall back to text search */ }
  }
  return _lr5(workspace, name);
};

const _uc5 = window.updateContext;
window.updateContext = async function (name) {
  const t = activeTab();
  if (isPy(t) && S.ctxTrack === "symbol" && !S.ctxLocked && name) {
    const defs = await smartDefAtCursor();
    if (defs.length && defs[0].name === name) return showContextFor(defs[0]);
  }
  return _uc5(name);
};

const _z1 = window.extendCommands, _z3 = window.afterBoot;
window.extendCommands = function () {
  _z1?.();
  cmd("toggleSmartRefs", "Smart Reference Matching (Python)", () => { S.refOpts.smart = !S.refOpts.smart; store.set("refOpts", S.refOpts); toast(`Smart Reference Matching ${S.refOpts.smart ? "on" : "off"}`); });
  MENUS.Options.splice(2, 0, "toggleSmartRefs");
};
window.afterBoot = async function () { await _z3?.(); };
