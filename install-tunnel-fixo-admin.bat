@echo off
chcp 65001 >nul
setlocal

:: Caminho do cloudflared (MSI instala em Program Files x86)
set "CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe"

:: Verificar se cloudflared existe
if not exist "%CLOUDFLARED%" (
    echo [ERRO] cloudflared nao encontrado em: %CLOUDFLARED%
    echo Baixe e instale: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
    pause
    exit /b 1
)

:: Arquivo com o token (na pasta do projeto)
set "TOKEN_FILE=%~dp0cloudflare-tunnel-token.txt"
if not exist "%TOKEN_FILE%" (
    echo.
    echo [AVISO] Arquivo de token nao encontrado: cloudflare-tunnel-token.txt
    echo.
    echo 1. Copie o arquivo cloudflare-tunnel-token.txt.example para cloudflare-tunnel-token.txt
    echo 2. Abra cloudflare-tunnel-token.txt e cole o token do Cloudflare (uma linha^)
    echo 3. Salve e execute este script novamente como Administrador.
    echo.
    pause
    exit /b 1
)

:: Ler token (primeira linha)
set "TOKEN="
<"%TOKEN_FILE%" set /p "TOKEN="
if "%TOKEN%"=="" (
    echo [ERRO] O arquivo cloudflare-tunnel-token.txt esta vazio. Cole o token e salve.
    pause
    exit /b 1
)

:: Remover linha em branco/BOM e espaços (token não tem espaços)
echo Instalando o servico do tunel fixo (Cloudflare Tunnel)...
echo.
"%CLOUDFLARED%" service install %TOKEN%
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] Falha ao instalar. Execute este script clicando com botao direito e "Executar como administrador".
    pause
    exit /b 1
)

echo.
echo Servico instalado. Iniciando...
sc start cloudflared
echo.
echo Pronto. O tunel fixo deve estar ativo. Verifique no dashboard do Cloudflare.
pause
