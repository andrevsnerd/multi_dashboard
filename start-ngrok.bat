@echo off
echo ============================================
echo    Iniciando Tunnel ngrok
echo ============================================
echo.
echo Expondo porta 3001 (servidor proxy) na internet...
echo.
echo IMPORTANTE: Se ainda não autenticou o ngrok, execute:
echo    ngrok config add-authtoken SEU_TOKEN
echo.
echo Para obter o token, acesse: https://dashboard.ngrok.com/get-started/your-authtoken
echo.
echo.
pause

ngrok http 3001

