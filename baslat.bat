@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Efes Cari SMS - Baslatici

cd /d "%~dp0"

echo ============================================
echo   Efes Cari SMS - Tek Tikla Baslatici
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi.
  echo Node.js 24 veya uzeri kurulmalidir: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [HATA] npm bulunamadi. Node.js kurulumunu kontrol edin.
  echo.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo [HATA] Node.js 24 veya uzeri gerekli.
  node -v
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Bagimliliklar yukleniyor. Bu islem biraz surebilir...
  call npm install
  if errorlevel 1 (
    echo [HATA] npm install basarisiz oldu.
    echo.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  if exist ".env.example" (
    echo .env bulunamadi; .env.example kopyalaniyor...
    copy /y ".env.example" ".env" >nul
    echo [UYARI] .env olusturuldu. Gerekirse ERP ve sifre ayarlarini duzenleyin.
  ) else (
    echo [UYARI] .env dosyasi bulunamadi.
  )
)

set "PORT=5555"
if exist ".env" for /f "tokens=2 delims==" %%B in ('findstr /B /C:"PORT=" ".env"') do set "PORT=%%B"
set "PORT=%PORT: =%"
if not defined PORT set "PORT=5555"

powershell -NoProfile -Command "$c = New-Object System.Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', %PORT%); exit 0 } catch { exit 1 } finally { $c.Dispose() }" >nul 2>&1
if not errorlevel 1 (
  echo Uygulama zaten calisiyor. Tarayici aciliyor...
  start "" "http://localhost:%PORT%"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

echo Uygulama baslatiliyor...
start "Efes Cari SMS Sunucu" cmd /k "npm start"
echo.
echo Sunucu penceresi acildi. Tarayici 4 saniye icinde acilacak.
echo Uygulamayi kapatmak icin sunucu penceresini kapatin.
ping -n 5 127.0.0.1 >nul
start "" "http://localhost:%PORT%"

exit /b 0
