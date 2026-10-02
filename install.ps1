# SourceWeb installer for Windows (PowerShell).  Run:  powershell -ExecutionPolicy Bypass -File install.ps1 [-Deps]
param([switch]$Deps)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }
$missing = @()
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $missing += "Git.Git" }
if (-not (Get-Command rg -ErrorAction SilentlyContinue)) { $missing += "BurntSushi.ripgrep.MSVC" }
if (-not (Get-Command ctags -ErrorAction SilentlyContinue)) { $missing += "UniversalCtags.Ctags" }
if ($missing.Count) {
  if ($Deps -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    foreach ($m in $missing) { Say "winget install $m"; winget install --silent --accept-package-agreements --accept-source-agreements -e --id $m }
    Write-Host "Open a NEW PowerShell window so the new tools are on PATH, then run install.ps1 again." -ForegroundColor Yellow; exit 0
  } else { Write-Host "Missing: $($missing -join ', '). Re-run with -Deps (uses winget) or install them manually." -ForegroundColor Yellow }
}
if (Get-Command py -ErrorAction SilentlyContinue) { $py = "py -3" } else { $py = "python" }
Say "Creating virtualenv"
Invoke-Expression "$py -m venv .venv"
& .\.venv\Scripts\python.exe -m pip install -q --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -q -r requirements.txt
if (Get-Command npm -ErrorAction SilentlyContinue) { Push-Location web\vendor; npm install -q --no-audit --no-fund prettier@3 | Out-Null; Pop-Location }
New-Item -ItemType Directory -Force -Path "$HOME\SourceWeb\projects" | Out-Null
Say "Done. Start with run.ps1 and open http://localhost:2727"
