# Obtiene el token de Bambu Cloud para el secreto BAMBU_TOKEN de GitHub.
# Uso: clic derecho > "Ejecutar con PowerShell", o:  powershell -ExecutionPolicy Bypass -File login.ps1
# Tu contrasena solo se envia a api.bambulab.com; el token se copia al portapapeles.
$ErrorActionPreference = 'Stop'
$api = 'https://api.bambulab.com/v1/user-service'
$headers = @{
  'User-Agent' = 'bambu_network_agent/01.09.05.01'
  'X-BBL-Client-Name' = 'OrcaSlicer'
  'X-BBL-Client-Type' = 'slicer'
  'X-BBL-Client-Version' = '01.09.05.51'
}

function Post($url, $body, $session) {
  $json = $body | ConvertTo-Json -Compress
  $p = @{ Uri = $url; Method = 'Post'; Body = $json; ContentType = 'application/json'; Headers = $headers }
  if ($session) { $p.WebSession = $session }
  Invoke-RestMethod @p
}

$email = Read-Host 'Email de tu cuenta Bambu Lab'
$sec = Read-Host 'Contrasena' -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

$r = Post "$api/user/login" @{ account = $email; password = $pass; apiError = '' }
$token = $r.accessToken

if (-not $token -and $r.loginType -eq 'verifyCode') {
  Post "$api/user/sendemail/code" @{ email = $email; type = 'codeLogin' } | Out-Null
  $code = Read-Host 'Te ha llegado un codigo por email. Escribelo'
  $r = Post "$api/user/login" @{ account = $email; code = $code }
  $token = $r.accessToken
}

if (-not $token -and $r.loginType -eq 'tfa') {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-WebRequest -Uri 'https://bambulab.com/api/csrf' -WebSession $s -Headers $headers -UseBasicParsing | Out-Null
  $csrf = ($s.Cookies.GetCookies('https://bambulab.com') | Where-Object Name -eq 'bbl_csrf_token').Value
  $headers['x-bbl-csrf-token'] = $csrf
  $code = Read-Host 'Codigo de tu app de verificacion en dos pasos'
  Post 'https://bambulab.com/api/sign-in/tfa' @{ tfaKey = $r.tfaKey; tfaCode = $code } $s | Out-Null
  $token = ($s.Cookies.GetCookies('https://bambulab.com') | Where-Object Name -eq 'token').Value
}

if (-not $token) { Write-Host 'No se pudo iniciar sesion. Revisa email, contrasena o codigo.' -ForegroundColor Red; exit 1 }

Set-Clipboard -Value $token
Write-Host ''
Write-Host 'OK. Token copiado al portapapeles (dura unos 3 meses).' -ForegroundColor Green
Write-Host 'Pegalo en GitHub: tu repositorio > Settings > Secrets and variables > Actions > BAMBU_TOKEN'
