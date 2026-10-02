# Start SourceWeb (Windows).  Set $env:SW_WORKSPACE / SW_PORT / SW_HOST first to change defaults.
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path data | Out-Null
& .\.venv\Scripts\python.exe -m server.app
