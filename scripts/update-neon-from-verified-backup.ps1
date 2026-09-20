$folder = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$previous = Join-Path $folder 'backup-gmobs-d1-2026-09-16T21-37-44.310Z.json.gz'
$latest = Join-Path $folder 'backup-gmobs-d1-2026-09-20T15-20-05.916Z.json.gz'
$replacement = Join-Path $folder 'backup-gmobs-d1-combinado-2026-09-20.json.gz'
if (-not (Test-Path -LiteralPath $previous -PathType Leaf) -or
    -not (Test-Path -LiteralPath $latest -PathType Leaf) -or
    -not (Test-Path -LiteralPath $replacement -PathType Leaf)) {
  throw 'Os arquivos de backup necessários não foram encontrados. Nada foi enviado.'
}

Write-Host 'Cole a Connection string do projeto gmobs-teste no Neon.'
Write-Host 'Escolha a branch production, o banco neondb e a opção Connection pooling.'
Write-Host 'A conexão não será exibida na tela nem salva em arquivo.'
$secureUrl = Read-Host 'Connection string do Neon' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  node (Join-Path $PSScriptRoot 'update-neon-from-verified-backup.mjs') $previous $latest $replacement
  if ($LASTEXITCODE -ne 0) { throw 'A atualização não foi concluída. Não ative o novo site.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
