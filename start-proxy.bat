@echo off
echo ============================================
echo    Iniciando Servidor Proxy Local
echo ============================================
echo.

cd proxy-server
echo [1/2] Iniciando servidor proxy...
start "Proxy Server" cmd /k "npm start"

timeout /t 3 /nobreak > nul

echo [2/2] Aguardando servidor iniciar...
timeout /t 2 /nobreak > nul

echo.
echo ============================================
echo    Proxy iniciado com sucesso!
echo ============================================
echo.
echo IMPORTANTE: Agora inicie o ngrok em outro terminal:
echo.
echo    ngrok http 3001
echo.
echo E copie a URL que aparecer para configurar no Vercel.
echo.
pause

