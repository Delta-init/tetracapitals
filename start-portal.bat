@echo off
REM ===================================================================
REM  Commission Portal - start everything for remote (India) access
REM  Double-click this file. It opens 3 windows: Backend, Frontend,
REM  and Public URL. Keep all 3 open. Closing a window stops that part.
REM
REM  The "Public URL" window prints a line like:
REM     https://something-random.trycloudflare.com
REM  Share THAT link with your team. It changes every time you restart.
REM ===================================================================

echo Starting Backend (API + database)...
REM MONGO_DB override keeps local dev on the "student_tracker" database (your
REM data), regardless of what .env is set to for production.
start "Commission Portal - Backend" cmd /k "cd /d C:\projects\student-tracker\backend && set MONGO_DB=student_tracker && "%USERPROFILE%\.bun\bin\bun.exe" run src\scripts\dev-with-mongo.ts"

echo Starting Frontend (website)...
start "Commission Portal - Frontend" cmd /k "cd /d C:\projects\student-tracker\frontend && npm run dev"

echo Waiting 10 seconds for the servers to warm up...
timeout /t 10 /nobreak >nul

echo Starting Public URL tunnel...
start "Commission Portal - PUBLIC URL (share this)" cmd /k ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:5173"

echo.
echo ===================================================================
echo  Three windows opened.
echo  Look at the "PUBLIC URL" window for the https://...trycloudflare.com
echo  link and share it with your team.
echo.
echo  Keep all three windows open while the team is using the portal.
echo ===================================================================
echo.
pause
