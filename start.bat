@echo off
rem Atlas: локальный сервер на 8644 (8642 — photo-editor, 8643 — travel-earth) и окно браузера
cd /d "%~dp0"
netstat -ano | findstr /r /c:":8644 .*LISTENING" >nul || start "Atlas server" /min python -m http.server 8644
timeout /t 1 >nul
start "" "http://localhost:8644/"
