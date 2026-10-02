#!/usr/bin/env bash
# SourceWeb installer for Linux and macOS.
#   ./install.sh                 install into this folder (creates .venv)
#   ./install.sh --deps          also install universal-ctags, ripgrep, git (uses apt/dnf/pacman/zypper/brew; may ask for sudo)
#   ./install.sh --service       also start SourceWeb automatically at login (systemd user service / launchd agent)
set -euo pipefail
cd "$(dirname "$0")"
DEPS=0; SERVICE=0
for a in "$@"; do case "$a" in --deps) DEPS=1 ;; --service) SERVICE=1 ;; *) echo "unknown option $a"; exit 2 ;; esac; done
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

# ---- system tools
need=()
command -v git >/dev/null || need+=(git)
command -v rg >/dev/null || need+=(ripgrep)
if ! ctags --version 2>/dev/null | grep -q "Universal Ctags"; then need+=(universal-ctags); fi
if [ ${#need[@]} -gt 0 ]; then
  if [ $DEPS -eq 1 ]; then
    say "Installing: ${need[*]}"
    if command -v brew >/dev/null; then brew install "${need[@]}"
    elif command -v apt-get >/dev/null; then sudo apt-get update -qq && sudo apt-get install -y "${need[@]}"
    elif command -v dnf >/dev/null; then sudo dnf install -y "${need[@]/universal-ctags/ctags}"
    elif command -v pacman >/dev/null; then sudo pacman -S --needed --noconfirm "${need[@]/universal-ctags/ctags}"
    elif command -v zypper >/dev/null; then sudo zypper install -y "${need[@]/universal-ctags/ctags}"
    else warn "No supported package manager found. Install manually: ${need[*]}"; fi
  else
    warn "Missing tools: ${need[*]}"
    warn "Re-run with --deps to install them, or install them yourself (see INSTALL.md)."
  fi
fi

# ---- python
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3 python; do
  if command -v $c >/dev/null && $c -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then PY=$c; break; fi
done
[ -n "$PY" ] || { warn "Python 3.10 or newer is required (python.org or your package manager)."; exit 1; }
say "Using $($PY --version)"
$PY -m venv .venv || { warn "Could not create a virtualenv. On Debian/Ubuntu: sudo apt install python3-venv"; exit 1; }
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r requirements.txt
say "Python packages installed"

# ---- optional: prettier for Reformat Source Code on JS/TS/JSON/YAML/Markdown
if command -v npm >/dev/null; then
  (cd web/vendor && npm install -q --no-audit --no-fund prettier@3 >/dev/null 2>&1) && say "prettier installed" || warn "prettier not installed (optional)"
else
  warn "npm not found: JS/TS reformatting is disabled (optional)"
fi

mkdir -p "$HOME/SourceWeb/projects"

if [ $SERVICE -eq 1 ]; then
  HERE="$(pwd)"
  if [ "$(uname)" = "Darwin" ]; then
    PL="$HOME/Library/LaunchAgents/com.sourceweb.server.plist"
    mkdir -p "$(dirname "$PL")"
    cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.sourceweb.server</string>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>ProgramArguments</key><array><string>$HERE/.venv/bin/python</string><string>-m</string><string>server.app</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HERE/data/server.log</string><key>StandardErrorPath</key><string>$HERE/data/server.log</string>
</dict></plist>
PLIST
    mkdir -p data; launchctl unload "$PL" 2>/dev/null || true; launchctl load "$PL"
    say "launchd agent installed (starts at login)"
  else
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/sourceweb.service" <<UNIT
[Unit]
Description=SourceWeb code browser
[Service]
WorkingDirectory=$HERE
ExecStart=$HERE/.venv/bin/python -m server.app
Restart=on-failure
[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload && systemctl --user enable --now sourceweb.service
    command -v loginctl >/dev/null && (loginctl enable-linger "$USER" 2>/dev/null || true)
    say "systemd user service installed (starts at boot)"
  fi
fi

say "Done. Start it with ./run.sh (or it is already running if you used --service), then open http://localhost:8765"
