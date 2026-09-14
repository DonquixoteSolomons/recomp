@echo off
rem Recomp — pull the latest Renpho weigh-ins and recompute. Schedule this nightly.
cd /d "%~dp0"
.venv\Scripts\python run_renpho.py
