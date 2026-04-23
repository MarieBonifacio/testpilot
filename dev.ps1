# TestPilot Development Server Launcher
# Usage: .\dev.ps1

$ErrorActionPreference = "Stop"
$global:processes = @()

function Write-Header {
    Write-Host "`n╔════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║                  TestPilot v2.0                        ║" -ForegroundColor Green
    Write-Host "║           Démarrage Backend + Frontend                 ║" -ForegroundColor Green
    Write-Host "╚════════════════════════════════════════════════════════╝`n" -ForegroundColor Green
}

function Test-Requirement {
    param([string]$Command, [string]$Name)
    
    try {
        & $Command --version | Out-Null
        Write-Host "✓ $Name trouvé" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "❌ $Name non trouvé" -ForegroundColor Red
        return $false
    }
}

function Cleanup {
    Write-Host "`n`nArrêt des serveurs..." -ForegroundColor Yellow
    foreach ($proc in $global:processes) {
        try {
            Stop-Process -Id $proc -ErrorAction SilentlyContinue
        }
        catch { }
    }
    exit 0
}

# Trap Ctrl+C
trap { Cleanup }

Write-Header

# Vérifier les prérequis
Write-Host "[0/4] Vérification des prérequis..."
if (-not (Test-Requirement "node" "Node.js")) { exit 1 }
if (-not (Test-Requirement "npm" "npm")) { exit 1 }
Write-Host ""

# Initialiser DB
Write-Host "[1/4] Initialisation de la base de données..."
try {
    & node init_db.js
    Write-Host "✓ Base de données prête`n" -ForegroundColor Green
}
catch {
    Write-Host "❌ Erreur BD: $_" -ForegroundColor Red
    exit 1
}

# Démarrer Backend
Write-Host "[2/4] Démarrage du serveur Backend (port 3000)..."
$backend = Start-Process -NoNewWindow -PassThru -FilePath "node" -ArgumentList "proxy.js"
$global:processes += $backend.Id
Write-Host "✓ Backend lancé (PID: $($backend.Id))`n" -ForegroundColor Green
Start-Sleep -Seconds 2

# Démarrer Frontend
Write-Host "[3/4] Démarrage du serveur Frontend (port 5173)..."
Push-Location "src-react"
$frontend = Start-Process -NoNewWindow -PassThru -FilePath "npm" -ArgumentList "run", "dev"
$global:processes += $frontend.Id
Pop-Location
Write-Host "✓ Frontend lancé (PID: $($frontend.Id))`n" -ForegroundColor Green

# Afficher le statut
Write-Host "[4/4] Serveurs actifs" -ForegroundColor Green
Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                ✈  Services Actifs                      ║" -ForegroundColor Cyan
Write-Host "├════════════════════════════════════════════════════════┤" -ForegroundColor Cyan
Write-Host "║  Backend  → http://localhost:3000                      ║" -ForegroundColor Cyan
Write-Host "║  Frontend → http://localhost:5173                      ║" -ForegroundColor Cyan
Write-Host "║  API      → http://localhost:3000/api                 ║" -ForegroundColor Cyan
Write-Host "║  DB       → testpilot.db                              ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "PIDs: Backend=$($backend.Id), Frontend=$($frontend.Id)" -ForegroundColor Gray
Write-Host "Appuyez sur Ctrl+C pour arrêter les serveurs" -ForegroundColor Yellow
Write-Host ""

# Attendre que les processus se terminent
while ($true) {
    if (-not (Get-Process -Id $backend.Id -ErrorAction SilentlyContinue)) {
        Write-Host "`n⚠️  Backend s'est arrêté" -ForegroundColor Yellow
        Cleanup
    }
    if (-not (Get-Process -Id $frontend.Id -ErrorAction SilentlyContinue)) {
        Write-Host "`n⚠️  Frontend s'est arrêté" -ForegroundColor Yellow
        Cleanup
    }
    Start-Sleep -Seconds 1
}
