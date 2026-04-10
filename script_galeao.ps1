$baseUrl = "https://multi-dashboard.vercel.app"
$adminUsername = "andre.sabetta"
$filialParaAdicionar = "SCARFME LLL - GALEAO RJ"

$usuariosAlvo = @(
  "scarfme.gru",
  "scarfme.higi",
  "scarfme.ibira",
  "scarfme.iguatemi",
  "scarfme.morumbi",
  "scarfme.oscar",
  "scarfme.paulista",
  "scarfme.villa"
)

$headers = @{
  "x-auth-username" = $adminUsername
  "Content-Type"    = "application/json"
}

$resp = Invoke-RestMethod -Uri "$baseUrl/api/admin/transferencia-permissoes" -Headers $headers -Method GET
$permissoes = @($resp.data)

foreach ($u in $usuariosAlvo) {
  $atual = $permissoes | Where-Object { $_.username -eq $u } | Select-Object -First 1
  if (-not $atual) { Write-Host "Sem permissão prévia, pulando: $u"; continue }

  $destinosControle = @($atual.filiaisDestinoControle)
  if ($destinosControle -notcontains $filialParaAdicionar) { $destinosControle += $filialParaAdicionar }

  $payload = [ordered]@{
    username                = $u
    filiaisOrigem           = @($atual.filiaisOrigem)
    filiaisDestino          = @($atual.filiaisDestino)
    filiaisDestinoControle  = $destinosControle
    tiposRomaneioPermitidos = @($atual.tiposRomaneioPermitidos)
    responsavelPadrao       = $atual.responsavelPadrao
    tipoRomaneioPadrao      = $atual.tipoRomaneioPadrao
    responsavelFixo         = [bool]$atual.responsavelFixo
    tipoRomaneioFixo        = [bool]$atual.tipoRomaneioFixo
    podeVerOutrasFiliais    = [bool]$atual.podeVerOutrasFiliais
    filialAtribuida         = $atual.filialAtribuida
  } | ConvertTo-Json -Depth 10

  Invoke-RestMethod -Uri "$baseUrl/api/admin/transferencia-permissoes" -Headers $headers -Method POST -Body $payload | Out-Null
  Write-Host "OK: $u"
}

Write-Host "Concluído."