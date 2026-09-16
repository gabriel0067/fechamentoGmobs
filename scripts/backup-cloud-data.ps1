param(
  [string]$SourceUrl = 'https://fechamentos-gmobs-mvf.grodriguesdepaula5.chatgpt.site/',
  [string]$OutputFile = ''
)

$operatorName = Read-Host 'Usuario de login do site atual'
$securePassword = Read-Host 'Senha de login do site atual' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:GMOBS_SOURCE_URL = $SourceUrl
  $env:GMOBS_LOGIN_USER = $operatorName
  $env:GMOBS_LOGIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($OutputFile) {
    node (Join-Path $PSScriptRoot 'backup-cloud-data.mjs') $OutputFile
  } else {
    node (Join-Path $PSScriptRoot 'backup-cloud-data.mjs')
  }
  if ($LASTEXITCODE -ne 0) { throw 'O backup não foi concluído. Nenhum dado do site foi apagado.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  Remove-Item Env:GMOBS_LOGIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:GMOBS_LOGIN_USER -ErrorAction SilentlyContinue
  Remove-Item Env:GMOBS_SOURCE_URL -ErrorAction SilentlyContinue
}
