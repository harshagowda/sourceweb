/* SourceWeb — user-managed projects (Project ▸ New Project / Remove Project) and the first-run screen. */
"use strict";

async function newProjectDialog() {
  const st = await api("/api/status").catch(() => ({}));
  const src = prompt(`New Project\n\nEnter a folder on the server (absolute path, or a name inside ${st.workspace || "the workspace"}),\nor a git URL to clone into the workspace:`, "");
  if (!src) return;
  const path = /^(https?:\/\/|git@|ssh:\/\/|\/|~)/.test(src) ? src : `${st.workspace}/${src}`;
  const name = prompt("Project name:", src.replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "project");
  if (name === null) return;
  toast(/^(https?:|git@|ssh:)/.test(src) ? "Cloning…" : "Adding project…", 8000);
  try {
    const r = await api("/api/projects/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, name }) });
    toast(`Project ${r.name} added — building symbols…`);
    log(`new project ${r.name} at ${r.path}`);
    await waitIndexed(r.name);
    await loadProjects();
    await setProject(r.name);
  } catch (e) { toast(`New Project failed: ${e.message}`, 7000); }
}
async function waitIndexed(name) {
  for (let i = 0; i < 240; i++) {
    const ps = await api("/api/projects");
    const p = ps.find((x) => x.name === name);
    if (p?.indexed) return p;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
async function removeProjectDialog() {
  palette({
    title: "Remove Project (unregisters it; files on disk are not touched)", items: S.projects,
    filter: (p, v) => p.name.toLowerCase().includes(v.toLowerCase()),
    render: (p) => `📦 <span>${esc(p.name)}</span><span class="right">${p.symbols} symbols</span>`,
    pick: async (p) => {
      if (!confirm(`Remove project ${p.name} from SourceWeb?\nIts files stay on disk.`)) return;
      await api(`/api/projects/${encodeURIComponent(p.name)}`, { method: "DELETE" });
      [...S.tabs].filter((t) => t.project === p.name && !t.dirty).forEach((t) => closeTab(t.key));
      await loadProjects();
      if (S.project === p.name) { if (S.projects[0]) await setProject(S.projects[0].name); else { S.project = null; renderWelcome(); } }
      toast(`Removed ${p.name}`);
    },
  });
}

// first run: no projects yet
const _renderWelcome9 = window.renderWelcome;
window.renderWelcome = function () {
  if (S.projects.length) return _renderWelcome9();
  $("#welcome").hidden = false;
  $("#welcome").innerHTML = `<h1>Welcome to SourceWeb</h1>
    <div class="muted">A fast, symbol-aware code browser. Add a project to start: SourceWeb builds the symbol database and keeps it in sync as files change.</div>
    <div class="grid"><div class="card" data-c="newProject"><b>➕ New Project…</b><span class="muted">a folder on this machine or a git URL</span></div>
    <div class="card" data-c="swHelp"><b>📖 SourceWeb help</b><span class="muted">user guide and key assignments</span></div></div>
    <p class="muted">Tip: any folder you put inside the workspace directory also appears as a project after a restart.</p>`;
  $$("#welcome .card[data-c]").forEach((c) => (c.onclick = () => runCmd(c.dataset.c)));
};

Object.assign(SW_MAP, { "new project": "newProject", "remove project": "removeProject", "open project": "openProjectDialog", "add file": "newFile" });
delete SW_UNAVAILABLE.removeProjectDisabled;
const _t1 = window.extendCommands;
window.extendCommands = function () {
  _t1?.();
  cmd("newProject", "New Project…", newProjectDialog);
  cmd("removeProject", "Remove Project…", removeProjectDialog);
};
const _t3 = window.afterBoot;
window.afterBoot = async function () { await _t3?.(); if (!S.projects.length) renderWelcome(); };
