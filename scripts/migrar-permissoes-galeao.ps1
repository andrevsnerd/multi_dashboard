# Migra as permissões de produção: troca o nome da filial Galeão de
# "SCARFME LLL - GALEAO RJ" (1 espaço) para "SCARFME LLL -  GALEAO RJ" (2 espaços),
# em filiaisOrigem, filiaisDestino e filiaisDestinoControle de TODOS os usuários.
#
# Produção persiste em Postgres via /api/admin/transferencia-permissoes (admin only).
# Rode com um login ADMIN. Por padrão faz DRY-RUN (não grava); use -Apply para gravar.
#
#   Dry-run (só mostra o que mudaria):  .\scripts\migrar-permissoes-galeao.ps1
#   Aplicar de fato:                    .\scripts\migrar-permissoes-galeao.ps1 -Apply

param(
  [string]$BaseUrl = "https://multi-dashboard.vercel.app",
  [string]$AdminUsername = "andre.sabetta",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"
$NOME_ANTIGO = "SCARFME LLL - GALEAO RJ"    # 1 espaço
$NOME_NOVO   = "SCARFME LLL -  GALEAO RJ"   # 2 espaços

$headers = @{
  "x-auth-username" = $AdminUsername
  "Content-Type"    = "application/json"
}

function Convert-Lista($lista) {
  $arr = @($lista)
  return ,@($arr | ForEach-Object { if ($_ -eq $NOME_ANTIGO) { $NOME_NOVO } else { $_ } })
}

Write-Host "Buscando permissões em $BaseUrl ..." -ForegroundColor Cyan
$resp = Invoke-RestMethod -Uri "$BaseUrl/api/admin/transferencia-permissoes" -Headers $headers -Method GET
$permissoes = @($resp.data)
Write-Host "  $($permissoes.Count) permissão(ões) encontradas." -ForegroundColor Cyan

$alteradas = 0
foreach ($p in $permissoes) {
  $origemNova   = Convert-Lista $p.filiaisOrigem
  $destinoNova  = Convert-Lista $p.filiaisDestino
  $controleNova = Convert-Lista $p.filiaisDestinoControle

  $mudou =
    (($origemNova   -join "|") -ne ((@($p.filiaisOrigem))          -join "|")) -or
    (($destinoNova  -join "|") -ne ((@($p.filiaisDestino))         -join "|")) -or
    (($controleNova -join "|") -ne ((@($p.filiaisDestinoControle)) -join "|"))

  if (-not $mudou) { continue }
  $alteradas++
  Write-Host "→ $($p.username): atualizando nome de Galeão (1→2 espaços)" -ForegroundColor Yellow

  if ($Apply) {
    $payload = [ordered]@{
      username                = $p.username
      filiaisOrigem           = $origemNova
      filiaisDestino          = $destinoNova
      filiaisDestinoControle  = $controleNova
      tiposRomaneioPermitidos = @($p.tiposRomaneioPermitidos)
      responsavelPadrao       = $p.responsavelPadrao
      tipoRomaneioPadrao      = $p.tipoRomaneioPadrao
      responsavelFixo         = [bool]$p.responsavelFixo
      tipoRomaneioFixo        = [bool]$p.tipoRomaneioFixo
      podeVerOutrasFiliais    = [bool]$p.podeVerOutrasFiliais
      filialAtribuida         = $p.filialAtribuida
    } | ConvertTo-Json -Depth 10

    Invoke-RestMethod -Uri "$BaseUrl/api/admin/transferencia-permissoes" -Headers $headers -Method POST -Body $payload | Out-Null
    Write-Host "  OK (gravado)" -ForegroundColor Green
  }
}

if ($alteradas -eq 0) {
  Write-Host "Nada a migrar — nenhuma permissão tinha o nome antigo." -ForegroundColor Green
} elseif ($Apply) {
  Write-Host "Concluído. $alteradas permissão(ões) atualizada(s) em produção." -ForegroundColor Green
} else {
  Write-Host "DRY-RUN: $alteradas permissão(ões) seriam atualizadas. Rode com -Apply para gravar." -ForegroundColor Magenta
}
