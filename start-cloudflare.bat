@echo off
echo ============================================
echo    Iniciando Cloudflare Tunnel
echo ============================================
echo.

REM Verificar se cloudflared está instalado
where cloudflared >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] cloudflared nao encontrado!
    echo.
    echo Por favor, instale o cloudflared primeiro:
    echo 1. Baixe de: https://github.com/cloudflare/cloudflared/releases
    echo 2. Ou execute no PowerShell (como Admin):
    echo    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "$env:USERPROFILE\cloudflared.exe"
    echo.
    pause
    exit /b 1
)

echo Verificando se o proxy esta rodando na porta 3001...
timeout /t 2 /nobreak > nul

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
pause > nul

REM Iniciar Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3001

pause
