@echo off
rem Dois cliques para subir o sistema no Windows. Para encerrar: Ctrl+C nesta janela.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale pelo site nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Dependencias nao instaladas. Rode "npm install" nesta pasta e tente de novo.
  pause
  exit /b 1
)

node scripts\supervisor.js
pause
