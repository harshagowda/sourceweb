# SourceWeb (Sw): a symbol-aware code browser in your browser

> Open source under Apache-2.0 (see `LICENSE` and `NOTICE`). SourceWeb is an independent project, not affiliated with any commercial code-editor vendor.

A self-hosted code browser and editor in the classic desktop code-browser style: symbol, project, context and relation
panels, full menus and right-click menus, and keyboard-driven navigation, plus a symbol database that is built and kept in sync for your own projects. It runs as a
small local server. Use it from a browser on the same machine, or from any device on your network with the access token.
Your code never leaves the machine.

**Install:** see [INSTALL.md](INSTALL.md). For Linux/macOS: `./install.sh --deps && ./run.sh`. For Windows: `install.ps1`. Docker works anywhere.
**Start:** open http://localhost:8765, then choose **Project ▸ New Project…** and pick a folder or a git URL.

## The layout
| Panel | What it does |
|---|---|
| **Symbol Window** (left) | Outline of the current file. Classes and longer-than-average functions are bold. Classes collapse. Sort by Name, Line or Type. Type in the box to filter. |
| **Editor** (centre) | Monaco with symbol-aware syntax formatting. Declarations are bold. References to project functions, classes and constants are coloured by kind; member references are italic. Also: change marks in the margin, closing-brace annotations, `#1`–`#4` comment headings, and the overview minimap with the current function highlighted. |
| **Project Window** (right) | **Files** (name-fragment filter; `*.py` + Enter filters by wildcard). **Tree**. **Repos** (all 41 repos). **Symbols** (Project Symbol List: `cre win`, `?regex`, `name(` for functions only, `.member`). **Categories**. **Git** (branches and checkout, commits, working-tree diff). **Report**. |
| **Context Window** (bottom left) | Shows the definition of whatever symbol is under the cursor. Lists alternatives when the name is ambiguous. Also previews files selected in lists. Can be locked; double-click to jump. |
| **Relation Window** (bottom right) | References (callers), Calls, Calls and Callers, Class Inheritance, Class Structure, or Auto by symbol type. Outline, horizontal or vertical graph. Auto-expands 1–4 levels. Lock, refresh, and 📌 to pin into extra Relation windows. |
| **Search Results** | List view or an editable text buffer with source links (Ctrl+L). Keeps a history of earlier searches. Shows the enclosing function for each hit. |
| Bookmarks · Clips · History · Findings · Activity Log | Bookmarks are symbol-relative: they stay on the right line after edits above them. **Findings** shows notes from `data/findings.json`, each linked to its code (optional). |

## Key assignments
| Key | Command | Key | Command |
|---|---|---|---|
| Alt+= / Ctrl+click | Jump To Definition | Ctrl+/ | Lookup References |
| Alt+, / Alt+. | Go Back / Go Forward | Ctrl+' | Smart Rename |
| F7 | Browse Project Symbols | Ctrl+F7 | Browse Global Symbols (all projects) |
| F8 | Browse Local File Symbols | Ctrl+P / Ctrl+O | Open file |
| Ctrl+M | Bookmark | Ctrl+Shift+M | Selection History |
| F5 / Ctrl+G | Go To Line | Ctrl+Shift+F | Search Project (simple / regex / keyword expression) |
| F3 / F4 | Search backward / forward | Shift+F4 | Search forward for selection |
| Ctrl+L / Shift+F9 / Shift+F8 | Jump to link / next / previous result | Alt+Shift+P | Project Search Bar |
| Keypad − / + | Function up / down | Alt+Keypad − / + | Previous / next change |
| Ctrl+Shift+H | Replace Files | Ctrl+Alt+D | File Compare (HEAD, branch, commit) |
| Ctrl+Shift+I | Symbol Info | Ctrl+Alt+W | Window List (MRU) |
| Ctrl+Shift+8 | Highlight Word | Ctrl+Shift+B | Browser Mode (click jumps, Backspace goes back) |
| Ctrl+Alt+F | Reformat (ruff / prettier) | Ctrl+Alt+1..4 | Layouts A–D |
| F1 / Ctrl+Shift+K | All commands and keys | F11 | Full screen |

## Language intelligence
- **All languages:** symbols come from universal-ctags. References come from ripgrep and are tied to their enclosing symbol, which builds the call trees.
- **Python:** jedi resolves the exact symbol. This is Smart Reference Matching, with import-following for definitions and context.
- **Terraform:** `var.x`, `local.x`, `module.m`, `module.m.output` (followed through the module's `source`), `data.t.n` and `type.name` resolve within the module's directory.

## Sessions and devices
Workspaces are stored on the server. They hold open files and cursor positions, history, bookmarks, clips, search options and layout. A new device picks up the `default` workspace automatically. Use Project ▸ Save Workspace As… / Open Workspace… for named sessions. Add `?ws=name` to the URL to pin a tab to a workspace.

## Files are kept in sync
Saving re-indexes the file. Changes made outside the browser (git pull, another editor) are detected within about 2 seconds. Open files reload unless you have unsaved edits; in that case you get a warning instead.

## What's inside
- `server/`: FastAPI server.
  - Universal Ctags builds a SQLite symbol index.
  - ripgrep finds references and the enclosing symbols that form call trees.
  - jedi gives exact Python references; there is also a Terraform resolver.
  - Also: file watching, git, compare, formatters and workspaces.
- `web/`: the browser app (vanilla JS plus the bundled Monaco editor). `features*.js` are the feature layers (panels, menus, search, compare, graph…).
- `docs/si_menus.json`: the menu bar and right-click menu layout, from which SourceWeb's menus are generated.
- `tests/smoke.py`: install check.
