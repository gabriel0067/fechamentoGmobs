$bytes = New-Object byte[] 48
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $generator.GetBytes($bytes)
  [Convert]::ToBase64String($bytes) | Set-Clipboard
  Write-Host 'Segredo de sessão novo e aleatório copiado para a área de transferência. Cole apenas na variável GMOBS_SESSION_SECRET da Vercel.'
} finally {
  $generator.Dispose()
  [Array]::Clear($bytes, 0, $bytes.Length)
}
