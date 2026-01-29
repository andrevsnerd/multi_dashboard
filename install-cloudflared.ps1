# Script PowerShell para instalar Cloudflared automaticamente

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Instalador Cloudflared" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se já está instalado
$cloudflaredPath = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cloudflaredPath) {
    Write-Host "[INFO] Cloudflared ja esta instalado!" -ForegroundColor Green
    Write-Host "Versao: " -NoNewline
    cloudflared --version
    Write-Host ""
    Write-Host "Deseja reinstalar? (S/N): " -NoNewline -ForegroundColor Yellow
    $resposta = Read-Host
    if ($resposta -ne "S" -and $resposta -ne "s") {
        Write-Host "Instalacao cancelada." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host "[1/3] Baixando cloudflared..." -ForegroundColor Yellow

# Criar pasta temporária
$tempDir = "$env:TEMP\cloudflared-install"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

# URL do download (Windows 64-bit)
$downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
$outputPath = "$tempDir\cloudflared.exe"

try {
    # Baixar cloudflared
    Invoke-WebRequest -Uri $downloadUrl -OutFile $outputPath -UseBasicParsing
    Write-Host "[OK] Download concluido!" -ForegroundColor Green
} catch {
    Write-Host "[ERRO] Falha ao baixar cloudflared: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/3] Instalando cloudflared..." -ForegroundColor Yellow

# Tentar instalar em System32 (requer admin)
$system32Path = "C:\Windows\System32\cloudflared.exe"
$needsAdmin = $false

try {
    # Tentar copiar para System32
    Copy-Item -Path $outputPath -Destination $system32Path -Force -ErrorAction Stop
    Write-Host "[OK] Cloudflared instalado em System32!" -ForegroundColor Green
} catch {
    # Se falhar, tentar instalar na pasta do usuário
    $userPath = "$env:USERPROFILE\cloudflared.exe"
    Copy-Item -Path $outputPath -Destination $userPath -Force
    Write-Host "[OK] Cloudflared instalado em: $userPath" -ForegroundColor Green
    Write-Host "[AVISO] Para usar 'cloudflared' de qualquer lugar, adicione ao PATH:" -ForegroundColor Yellow
    Write-Host "       $userPath" -ForegroundColor Gray
    $needsAdmin = $true
}

Write-Host ""
Write-Host "[3/3] Verificando instalacao..." -ForegroundColor Yellow

# Limpar arquivo temporário
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

# Verificar instalação
if (Test-Path $system32Path) {
    $cloudflaredCmd = $system32Path
} elseif (Test-Path "$env:USERPROFILE\cloudflared.exe") {
    $cloudflaredCmd = "$env:USERPROFILE\cloudflared.exe"
} else {
    Write-Host "[ERRO] Instalacao falhou!" -ForegroundColor Red
    exit 1
}

# Testar versão
try {
    $version = & $cloudflaredCmd --version
    Write-Host "[OK] Cloudflared instalado com sucesso!" -ForegroundColor Green
    Write-Host "Versao: $version" -ForegroundColor Gray
} catch {
    Write-Host "[AVISO] Cloudflared instalado, mas nao foi possivel verificar versao" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Instalacao Concluida!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "PROXIMOS PASSOS:" -ForegroundColor Cyan
Write-Host "1. Execute: cloudflared tunnel --url http://localhost:3001" -ForegroundColor White
Write-Host "2. Ou use: start-cloudflare.bat" -ForegroundColor White
Write-Host "3. Copie a URL fornecida" -ForegroundColor White
Write-Host "4. Configure no Vercel como PROXY_URL" -ForegroundColor White
Write-Host ""
Write-Host "Para mais informacoes, veja: docs/CLOUDFLARE_TUNNEL_SETUP.md" -ForegroundColor Gray
Write-Host ""

if ($needsAdmin) {
    Write-Host "[AVISO] Para usar 'cloudflared' sem caminho completo," -ForegroundColor Yellow
    Write-Host "       execute este script como Administrador." -ForegroundColor Yellow
    Write-Host ""
}
