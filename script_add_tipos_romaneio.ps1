$baseUrl = "https://multi-dashboard.vercel.app"
$adminUsername = "andre.sabetta"
$novosTipos = @("SAIDA PARCERIA", "RETIRADA SOCIO")

$headers = @{
  "x-auth-username" = $adminUsername
  "Content-Type"    = "application/json"
}

$users = Invoke-RestMethod -Uri "$baseUrl/api/admin/users" -Headers $headers -Method GET
$permsResp = Invoke-RestMethod -Uri "$baseUrl/api/admin/transferencia-permissoes" -Headers $headers -Method GET
$perms = @($permsResp.data)

foreach ($u in ($users | Where-Object { $_.role -in @("gestor", "logistica") })) {
  $atual = $perms | Where-Object { $_.username -eq $u.username } | Select-Object -First 1
  if (-not $atual) {
    Write-Host "Sem permissao cadastrada, pulando: $($u.username)"
    continue
  }

  $tipos = @($atual.tiposRomaneioPermitidos)

  # Regra do sistema: lista vazia significa "todos os tipos permitidos".
  if ($tipos.Count -eq 0) {
    Write-Host "Ja possui todos os tipos (lista vazia), pulando: $($u.username)"
    continue
  }

  foreach ($t in $novosTipos) {
    if ($tipos -notcontains $t) {
      $tipos += $t
    }
  }

  $payload = [ordered]@{
    username                = $u.username
    filiaisOrigem           = @($atual.filiaisOrigem)
    filiaisDestino          = @($atual.filiaisDestino)
    filiaisDestinoControle  = @($atual.filiaisDestinoControle)
    tiposRomaneioPermitidos = $tipos
    responsavelPadrao       = $atual.responsavelPadrao
    tipoRomaneioPadrao      = $atual.tipoRomaneioPadrao
    responsavelFixo         = [bool]$atual.responsavelFixo
    tipoRomaneioFixo        = [bool]$atual.tipoRomaneioFixo
    podeVerOutrasFiliais    = [bool]$atual.podeVerOutrasFiliais
    filialAtribuida         = $atual.filialAtribuida
  } | ConvertTo-Json -Depth 10

  Invoke-RestMethod -Uri "$baseUrl/api/admin/transferencia-permissoes" -Headers $headers -Method POST -Body $payload | Out-Null
  Write-Host "OK: $($u.username)"
}

Write-Host "Concluido."
