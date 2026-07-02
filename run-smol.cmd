@echo off
REM RepoYeti daemon under bun --smol (reduced-memory mode; compare vs run-normal.cmd).
REM Quit the tray app first so the single-instance guard doesn't refuse this one.
cd /d "%~dp0"
title RepoYeti daemon (bun --smol)
bun --smol src/index.ts start
pause
