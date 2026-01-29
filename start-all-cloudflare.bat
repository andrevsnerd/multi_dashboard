@echo off
echo ============================================
echo    Iniciando Proxy + Cloudflare Tunnel
echo ============================================
echo.

REM Definir caminho do cloudflared
set "CLOUDFLARED_PATH=%USERPROFILE%\cloudflared.exe"

REM Verificar se cloudflared está instalado
if not exist "%CLOUDFLARED_PATH%" (
    echo [ERRO] cloudflared nao encontrado em: %CLOUDFLARED_PATH%
    echo.
    echo Por favor, instale o cloudflared primeiro.
    echo Execute: powershell -ExecutionPolicy Bypass -File install-cloudflared.ps1
    echo.
    pause
    exit /b 1
)

REM Iniciar o proxy
echo [1/2] Iniciando servidor proxy...
call start-proxy.bat

REM Aguardar um pouco para o proxy iniciar
echo.
echo [2/2] Aguardando proxy iniciar...
timeout /t 5 /nobreak > nul

REM Iniciar Cloudflare Tunnel
echo.
echo [2/2] Iniciando Cloudflare Tunnel...
start "Cloudflare Tunnel" cmd /k ""%CLOUDFLARED_PATH%" tunnel --url http://localhost:3001"

echo.
echo ============================================
echo    Tudo iniciado!
echo ============================================
echo.
echo 1. Verifique se o proxy esta rodando (janela "Proxy Server")
echo 2. Copie a URL do Cloudflare Tunnel (janela "Cloudflare Tunnel")
echo 3. Configure no Vercel:
echo    - PROXY_URL = URL do Cloudflare Tunnel
echo    - PROXY_SECRET = (veja no .env.local)
echo.
echo IMPORTANTE: A URL do Cloudflare Tunnel aparecera na janela do tunnel
echo.
pause
