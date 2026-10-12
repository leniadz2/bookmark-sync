# .\scripts\backup-vivaldi.ps1


$ErrorActionPreference = "Stop"

$Repo = Split-Path $PSScriptRoot -Parent
$Source = "$env:LOCALAPPDATA\Vivaldi\User Data\Default\Bookmarks"
$Destination = Join-Path $Repo "data\vivaldi-bookmarks-backup.json"

if (-not (Test-Path $Source)) {
    throw "No existe el archivo: $Source"
}

# Crear respaldo
Copy-Item $Source $Destination -Force

# Validar JSON
$json = Get-Content $Destination -Raw | ConvertFrom-Json

Write-Host "Backup generado: $Destination" -ForegroundColor Green
Write-Host "Raices:" ($json.roots.PSObject.Properties.Name -join ", ")
Write-Host "Marcadores barra:" $json.roots.bookmark_bar.children.Count
Write-Host "Marcadores otros:" $json.roots.other.children.Count
