# Launches EE2 dev: renderer (vite) + main (electron) in two windows.
# Usage:  .\dev.ps1
$root = $PSScriptRoot

# Free port 5173 if something is squatting it — otherwise vite falls back to
# 5174 and the main process (hardcoded to 5173) can't connect.
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Host "Freeing port 5173 (PID $($_.OwningProcess))..."
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }

Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\renderer'; npm run dev"
Start-Sleep -Seconds 3
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$root\main'; npm run dev"
Write-Host "Started renderer (vite) and main (electron) dev processes in separate windows."
