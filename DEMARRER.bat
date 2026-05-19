@echo off
title MaintenanceOps - Serveur
color 0A
echo.
echo  ========================================
echo    MaintenanceOps - Demarrage serveur
echo  ========================================
echo.
cd /d "%~dp0"
echo  Installation des dependances...
call npm install --silent
echo.
echo  Lancement du serveur...
echo.
node server.js
pause
