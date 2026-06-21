@echo off
echo Starting Next.js Development Server...
cd /d "%~dp0"
npx next dev --port 3000 --hostname 127.0.0.1
pause