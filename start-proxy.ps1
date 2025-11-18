# Script PowerShell para iniciar o servidor proxy

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Iniciando Servidor Proxy Local" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Navegar para a pasta do proxy
Set-Location -Path "proxy-server"

# Ler o PROXY_SECRET do .env.local
$envContent = Get-Content "../.env.local" | Where-Object { $_ -match "PROXY_SECRET" }
$proxySecret = ($envContent -split "=")[1].Trim()

Write-Host "[1/3] Verificando configurações..." -ForegroundColor Yellow

# Verificar se as dependências estão instaladas
if (-not (Test-Path "node_modules")) {
    Write-Host "[1.5/3] Instalando dependências..." -ForegroundColor Yellow
    npm install
}

Write-Host "[2/3] Iniciando servidor proxy na porta 3001..." -ForegroundColor Yellow
Write-Host ""

# Iniciar o servidor em uma nova janela
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; npm start"

# Aguardar um pouco
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Proxy iniciado!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "PROXY_SECRET para usar no Vercel:" -ForegroundColor Yellow
Write-Host "  $proxySecret" -ForegroundColor White
Write-Host ""
Write-Host "PROXIMOS PASSOS:" -ForegroundColor Cyan
Write-Host "  1. Abra um NOVO terminal" -ForegroundColor White
Write-Host "  2. Execute: ngrok http 3001" -ForegroundColor White
Write-Host "  3. Copie a URL do ngrok (ex: https://abc123.ngrok-free.app)" -ForegroundColor White
Write-Host "  4. Configure no Vercel:" -ForegroundColor White
Write-Host "     - PROXY_URL = URL do ngrok" -ForegroundColor Gray
Write-Host "     - PROXY_SECRET = $proxySecret" -ForegroundColor Gray
Write-Host ""
Write-Host "Pressione qualquer tecla para verificar se o proxy está rodando..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Verificar se está rodando
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Host ""
    Write-Host "✅ Proxy está rodando corretamente!" -ForegroundColor Green
    $healthData = $response.Content | ConvertFrom-Json
    Write-Host "   Status: $($healthData.status)" -ForegroundColor White
    Write-Host "   Database: $($healthData.database)" -ForegroundColor White
} catch {
    Write-Host ""
    Write-Host "⚠️  Proxy ainda não está respondendo. Aguarde alguns segundos..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pressione qualquer tecla para fechar..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

