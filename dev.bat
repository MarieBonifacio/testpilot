@echo off
chcp 65001 >nul
title TestPilot Development - Backend & Frontend
color 0A

cls
echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║                  TestPilot v2.0                        ║
echo ║           Démarrage Backend + Frontend                 ║
echo ╚════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

REM Vérifier node
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js non trouvé. Installer Node.js depuis https://nodejs.org
    pause
    exit /b 1
)

REM Vérifier npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ npm non trouvé.
    pause
    exit /b 1
)

echo ✓ Node et npm trouvés
echo.

REM Initialiser la base de données
echo [1/3] Initialisation de la base de données...
node init_db.js
if errorlevel 1 (
    echo ❌ Erreur lors de l'initialisation de la DB
    pause
    exit /b 1
)
echo ✓ Base de données prête
echo.

REM Démarrer Backend
echo [2/3] Démarrage du serveur Backend (port 3000)...
start "TestPilot Backend" cmd /k "node proxy.js"
timeout /t 3 /nobreak >nul
echo ✓ Backend lancé
echo.

REM Démarrer Frontend
echo [3/3] Démarrage du serveur Frontend (port 5173)...
start "TestPilot Frontend" cmd /k "cd /d "%~dp0src-react" && npm run dev"
echo ✓ Frontend lancé
echo.

echo ╔════════════════════════════════════════════════════════╗
echo ║                ✈  Serveurs Actifs                      ║
echo ├════════════════════════════════════════════════════════╤
echo ║  Backend  → http://localhost:3000                      ║
echo ║  Frontend → http://localhost:5173                      ║
echo ║  API      → http://localhost:3000/api                 ║
echo ╚════════════════════════════════════════════════════════╝
echo.
echo Deux fenêtres de terminal vont s'ouvrir.
echo Fermer une fenêtre arrêtera le serveur correspondant.
echo Ctrl+C pour quitter proprement.
echo.
pause
