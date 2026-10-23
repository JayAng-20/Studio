@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node server.mjs %1
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py %1
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py %1
  goto :eof
)
echo 找不到 Node.js 或 Python，請先安裝其中一個（https://nodejs.org 或 https://www.python.org）。
pause
