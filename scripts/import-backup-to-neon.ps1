param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile
)

if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
  throw 'Arquivo de backup não encontrado.'
}

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
