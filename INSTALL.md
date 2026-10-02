# Installing SourceWeb

SourceWeb (Sw) is a symbol-aware code browser that runs as a small local web server. You use it from any
browser: on the same machine, or from other devices on your network using an access token.

**Requirements:**
- Python 3.10 or newer.
- git, ripgrep, and **Universal** Ctags (not the old Exuberant Ctags).
- Optional: Node.js/npm, for reformatting JS/TS/JSON/YAML/Markdown with prettier.
- About 60 MB of disk, plus the symbol index (roughly 1–5 MB per 100k lines of code).

## Linux

```bash
unzip SourceWeb-*.zip && cd SourceWeb
./install.sh --deps            # installs git/ripgrep/universal-ctags (apt, dnf, pacman, zypper) and the Python packages
./run.sh                       # or: ./install.sh --service   to start at boot (systemd user service)
```

## macOS

```bash
brew install python git ripgrep universal-ctags   # or let the installer do it:  ./install.sh --deps
unzip SourceWeb-*.zip && cd SourceWeb
./install.sh
./run.sh                       # or: ./install.sh --service   to start at login (launchd)
```

## Windows

Two options:
- **Docker Desktop** (recommended): see below.
- **Native**, in PowerShell:

```powershell
Expand-Archive SourceWeb-*.zip; cd SourceWeb\SourceWeb
powershell -ExecutionPolicy Bypass -File install.ps1 -Deps   # winget: Git, ripgrep, Universal Ctags; then open a new window and run it again
powershell -ExecutionPolicy Bypass -File run.ps1
```

## Docker (any OS)

```bash
cd SourceWeb
SOURCEWEB_PROJECTS=~/code docker compose up -d     # every sub-folder of ~/code becomes a project
cat data/token                                     # access token for other devices
```

## First use
1. Open **http://localhost:2727**.
2. Choose **Project ▸ New Project…**. Enter a folder path on the server machine, or a git URL to clone into the workspace.
3. SourceWeb builds the symbol database and keeps it in sync as files change. You don't need to do anything else.

Any folder you put in the workspace directory (default `~/SourceWeb/projects`, set with `SW_WORKSPACE`) also
appears as a project when SourceWeb starts.

## Opening it from other devices (phone, tablet, another computer)

The server prints a link like `http://<this-machine-ip>:2727/?token=XXXX`. The token is also in `data/token`.

- **The token:** it works like a password. Opening the link once logs that browser in for 30 days.
- **Reachability:** the other device must be able to reach this machine on port 2727. That means the same network, a VPN, or an allowed firewall rule.
- **This machine only:** set `SW_HOST=127.0.0.1`.
- **Read-only:** `SW_READONLY=1` disables saving, rename and replace.

## Help

Help ▸ SourceWeb Help opens this guide locally, and F1 lists every command with its key. SourceWeb never contacts external sites.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `SW_WORKSPACE` | `~/SourceWeb/projects` | Folder whose sub-folders are projects |
| `SW_DATA` | `./data` | Symbol index, workspaces/layouts, access token |
| `SW_PORT` / `SW_HOST` | `2727` / `0.0.0.0` | Where the server listens |
| `SW_TOKEN` | random (saved in `data/token`) | Fixed access token |
| `SW_READONLY` | off | `1` = browse only |

## Uninstall

Delete the SourceWeb folder. Also remove these if you used `--service`:
- Linux: `systemctl --user disable --now sourceweb` and `~/.config/systemd/user/sourceweb.service`.
- macOS: `launchctl unload ~/Library/LaunchAgents/com.sourceweb.server.plist` and delete that file.

Your projects are never modified by uninstalling.

## Check the install

`.venv/bin/python tests/smoke.py` starts a temporary server on a demo project and checks indexing, search,
references and the web UI files.
