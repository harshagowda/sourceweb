#!/usr/bin/env bash
# Start SourceWeb in the foreground.  Environment:
#   SW_WORKSPACE  folder whose sub-folders are projects (default ~/SourceWeb/projects)
#   SW_PORT       port (default 2727)          SW_HOST  bind address (default 0.0.0.0; use 127.0.0.1 for this machine only)
#   SW_DATA       index/settings folder (default ./data)   SW_READONLY=1  disable saving/rename/replace
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "Run ./install.sh first"; exit 1; }
mkdir -p data
exec .venv/bin/python -m server.app
