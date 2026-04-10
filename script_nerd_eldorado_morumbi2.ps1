$baseUrl = "https://multi-dashboard.vercel.app"
$adminUsername = "andre.sabetta"

# "NERD MORUMBI 2 (RRX)" na UI usa este valor interno no backend.
$filiaisParaAdicionar = @(
  "NERD ELDORADO",
  "NERD MORUMBI RDRRX"
)

$usuariosAlvo = @(
  "nerd.centernorte",
  "nerd.higi",
  "nerd.leblon",
  "nerd.morumbi",
  "nerd.villa"
)

$headers = @{
  "x-auth-username" = $adminUsername
  "Content-Type"    = "application/json"
}

$resp = Invoke-RestMethod -Uri "$baseUrl/api/admin/transferencia-permissoes" -Headers $headers -Method GET
$permissoes = @($resp.data)

foreach ($u in $usuariosAlvo) {
  $atual = $permissoes | Where-Object { $_.username -eq $u } | Select-Object -First 1
  if (-not $atual) {
    Write-Host "Sem permissão prévia, pulando: $u"
    continue
  }

  $destinosControle = @($atual.filiaisDestinoControle)
  foreach ($filial in $filiaisParaAdicionar) {
    if ($destinosControle -notcontains $filial) {
      $destinosControle += $filial
    }
  }

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
