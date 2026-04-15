@echo off
cd C:\Dev\testpilot
start "TestPilot Backend" cmd /k "node proxy.js"
timeout /t 2 /nobreak >nul
cd C:\Dev\testpilot\src-react
start "TestPilot Frontend" cmd /k "npm run dev"
