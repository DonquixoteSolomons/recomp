@echo off
rem Recomp — double-click to run. Leave this window open; close it to stop.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo First run: creating .venv and installing...
  python -m venv .venv && .venv\Scripts\python -m pip install -q -r requirements.txt
)
echo.
echo   Recomp is running.  On this PC: http://localhost:8765
echo   From your phone (Tailscale):    http://%COMPUTERNAME%:8765
echo.
.venv\Scripts\python -m uvicorn app:app --host 0.0.0.0 --port 8765 --log-level warning
