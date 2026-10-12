
param(
    [string[]]$ExtensionIds = @(
        "mcigpbddonhjjghaagndhmlfoelfmglh"
    ),

    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Repo = Split-Path $PSScriptRoot -Parent
$Native = Join-Path $Repo "native"

$Exe = Join-Path $Native "dist\bookmark_host.exe"
$Manifest = Join-Path $Native "native_host.json"

$HostName = "com.bookmark_sync.native_host"

Write-Host ""
Write-Host "Bookmark Sync - Native Host" -ForegroundColor Cyan
Write-Host "Repositorio: $Repo"

# 1. Compilar el host
if (-not $SkipBuild) {

    py -3 --version

    if ($LASTEXITCODE -ne 0) {
        throw "Python 3 no disponible"
    }

    py -3 -m pip show pyinstaller *> $null

    if ($LASTEXITCODE -ne 0) {
        py -3 -m pip install pyinstaller

        if ($LASTEXITCODE -ne 0) {
            throw "Error instalando PyInstaller"
        }
    }

    Push-Location $Native

    try {
        py -3 -m PyInstaller `
            --onefile `
            --console `
            --clean `
            --noconfirm `
            --name bookmark_host `
            bookmark_host.py

        if ($LASTEXITCODE -ne 0) {
            throw "Error compilando el host"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path $Exe)) {
    throw "No existe el ejecutable: $Exe"
}

# 2. Validar IDs de extensiones
$ExtensionIds = @(
    $ExtensionIds |
        ForEach-Object { $_.Trim() } |
        Select-Object -Unique
)

foreach ($Id in $ExtensionIds) {
    if ($Id -cnotmatch '^[a-p]{32}$') {
        throw "ID de extensión inválido: $Id"
    }
}

if ($ExtensionIds.Count -eq 0) {
    throw "Debe especificarse al menos un ID de extensión"
}

# 3. Generar manifiesto Native Messaging
$Config = [ordered]@{
    name = $HostName
    description = "Bookmark Sync Native Host"
    path = $Exe
    type = "stdio"
    allowed_origins = @(
        $ExtensionIds | ForEach-Object {
            "chrome-extension://$_/"
        }
    )
}

$Json = $Config | ConvertTo-Json -Depth 5
$Utf8 = [System.Text.UTF8Encoding]::new($false)

[System.IO.File]::WriteAllText(
    $Manifest,
    $Json,
    $Utf8
)

Write-Host ""
Write-Host "Manifiesto generado: $Manifest" -ForegroundColor Green

# 4. Registrar navegadores
$Browsers = [ordered]@{
    "Google Chrome" = "HKCU:\Software\Google\Chrome\NativeMessagingHosts"
    "Microsoft Edge" = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
    "Vivaldi" = "HKCU:\Software\Vivaldi\NativeMessagingHosts"
    "Brave" = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"
    "Opera" = "HKCU:\Software\Opera Software\NativeMessagingHosts"
}

foreach ($Browser in $Browsers.Keys) {

    $RegistryPath = Join-Path $Browsers[$Browser] $HostName

    try {
        New-Item -Path $RegistryPath -Force | Out-Null
        Set-Item -Path $RegistryPath -Value $Manifest

        Write-Host "[OK] $Browser" -ForegroundColor Green
    }
    catch {
        Write-Warning "No se pudo registrar ${Browser}: $_"
    }
}

Write-Host ""
Write-Host "Instalación finalizada" -ForegroundColor Green
Write-Host "Host: $Exe"
Write-Host "JSON: $Repo\data\bookmarks.json"
Write-Host "IDs autorizados: $($ExtensionIds -join ', ')"
