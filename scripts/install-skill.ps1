# Installs the "gemini-tamil-brief" skill for Claude Code on Windows (PowerShell).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-skill.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-skill.ps1 -Project C:\path\to\project
param([string]$Project = "")

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $PSScriptRoot
$Src = Join-Path $RepoDir "skills\gemini-tamil-brief"
if (-not (Test-Path (Join-Path $Src "SKILL.md"))) { throw "Cannot find $Src\SKILL.md" }

if ($Project) { $DestRoot = Join-Path $Project ".claude\skills" }
else { $DestRoot = Join-Path $HOME ".claude\skills" }
$Dest = Join-Path $DestRoot "gemini-tamil-brief"

New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
if (Test-Path $Dest) {
  # Backups go OUTSIDE the skills folder, or Claude Code would load two skills with the same name.
  $BackupDir = Join-Path (Split-Path -Parent $DestRoot) "skill-backups"
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $Backup = Join-Path $BackupDir ("gemini-tamil-brief-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Move-Item $Dest $Backup
  Write-Host "Existing skill moved to: $Backup"
}
Copy-Item -Recurse $Src $Dest
Write-Host "Copied to: $Dest"
Write-Host ""
Write-Host "Done. Start a NEW Claude Code session, then type:  /gemini-tamil-brief"
