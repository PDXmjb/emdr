@echo off
rem Launch EMDR Companion: local server + Edge. Double-click to run.
cd /d "%~dp0"

where py >nul 2>nul && (py -3 serve.py %* & goto :done)
where python >nul 2>nul && (python serve.py %* & goto :done)

echo Python was not found. Install it from https://www.python.org/downloads/ or the Microsoft Store.
pause
exit /b 1

:done
if errorlevel 1 pause
