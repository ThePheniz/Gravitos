@echo off
rem Serves Gravitos at http://localhost:8765 for installing or updating the PC app (see README).
rem Uses only Windows' built-in PowerShell. Close this window to stop; the installed app keeps working.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
