param(
  [string]$BackupFile = ''
)

if (-not $BackupFile) {
  $backupFolder = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $candidate = Get-ChildItem -LiteralPath $backupFolder -Filter 'backup-gmobs-d1-*.json.gz' -File |
    Where-Object { $_.Name -notlike '*copia-verificada*' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $candidate) { throw 'Nenhum backup integral do banco foi encontrado.' }
  $BackupFile = $candidate.FullName
}

if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
  throw 'Arquivo de backup não encontrado.'
}

Write-Host "Backup selecionado: $([IO.Path]::GetFileName($BackupFile))"
$secureUrl = Read-Host 'Cole a URL de conexão da branch de TESTE do Neon' -AsSecureString
$urlPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
try {
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($urlPointer)
  node (Join-Path $PSScriptRoot 'import-backup-to-neon.mjs') $BackupFile
  if ($LASTEXITCODE -ne 0) { throw 'A importação não foi concluída. Não publique o novo site.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($urlPointer)
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
