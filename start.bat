@echo off
echo Demarrage TestPilot...
cd /d C:\Dev\testpilot
start "Backend" cmd /k "node proxy.js"
timeout /t 2 /nobreak >nul
cd /d C:\Dev\testpilot\src-react
start "Frontend" cmd /k "npm run dev"
echo Serveurs demarres. Veuillez ouvrir http://localhost:5173
pause
