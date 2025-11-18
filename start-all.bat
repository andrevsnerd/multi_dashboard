@echo off
echo ============================================
echo    Iniciando Proxy + ngrok
echo ============================================
echo.

REM Iniciar o proxy
call start-proxy.bat

REM Aguardar um pouco
timeout /t 5 /nobreak > nul

REM Iniciar ngrok
echo.
echo Iniciando ngrok...
start "ngrok Tunnel" cmd /k "ngrok http 3001"

echo.
echo ============================================
echo    Tudo iniciado!
echo ============================================
echo.
echo 1. Verifique se o proxy está rodando (janela "Proxy Server")
echo 2. Copie a URL do ngrok (janela "ngrok Tunnel")
echo 3. Configure no Vercel:
echo    - PROXY_URL = URL do ngrok
echo    - PROXY_SECRET = (veja no .env.local)
echo.
pause

