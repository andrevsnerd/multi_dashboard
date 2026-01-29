@echo off
echo ============================================
echo    Iniciando Cloudflare Tunnel
echo ============================================
echo.

set "CLOUDFLARED_PATH=%USERPROFILE%\cloudflared.exe"

if not exist "%CLOUDFLARED_PATH%" (
    echo [ERRO] cloudflared nao encontrado em: %CLOUDFLARED_PATH%
    echo.
    echo Por favor, instale o cloudflared primeiro.
    echo Execute: powershell -ExecutionPolicy Bypass -File install-cloudflared.ps1
    echo.
    pause
    exit /b 1
)

echo [OK] Cloudflared encontrado!
echo.

echo Verificando se o proxy esta rodando na porta 3001...
netstat -ano | findstr ":3001" >nul 2>&1
if errorlevel 1 (
    echo [AVISO] Proxy nao parece estar rodando na porta 3001
    echo Certifique-se de que o proxy esta ativo antes de continuar.
    echo.
)

echo.
echo ============================================
echo    Iniciando Tunnel...
echo ============================================
echo.
echo IMPORTANTE:
echo - O proxy deve estar rodando na porta 3001
echo - Copie a URL que aparecer abaixo
echo - Configure no Vercel como PROXY_URL
echo.
echo Pressione qualquer tecla para iniciar o tunnel...
pause >nul

"%CLOUDFLARED_PATH%" tunnel --url http://localhost:3001

pause
