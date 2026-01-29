@echo off
echo ============================================
echo    Iniciando Proxy + Cloudflare Tunnel
echo ============================================
echo.

REM Verificar se cloudflared está instalado
where cloudflared >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] cloudflared nao encontrado!
    echo.
    echo Por favor, instale o cloudflared primeiro.
    echo Veja o guia em: docs/CLOUDFLARE_TUNNEL_SETUP.md
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
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3001"

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
