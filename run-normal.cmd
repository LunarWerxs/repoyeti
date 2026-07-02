@echo off
REM RepoYeti daemon under normal bun (for comparing memory vs run-smol.cmd).
REM Quit the tray app first so the single-instance guard doesn't refuse this one.
cd /d "%~dp0"
title RepoYeti daemon (normal bun)
bun src/index.ts start
pause
