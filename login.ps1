# Obtiene el token de Bambu Cloud para el secreto BAMBU_TOKEN de GitHub.
# Uso: doble clic en login.bat
# Tu contrasena solo se envia a api.bambulab.com; el token se copia al portapapeles.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$api = 'https://api.bambulab.com/v1/user-service'
$headers = @{
  'User-Agent' = 'bambu_network_agent/01.09.05.01'
  'X-BBL-Client-Name' = 'OrcaSlicer'
  'X-BBL-Client-Type' = 'slicer'
  'X-BBL-Client-Version' = '01.09.05.51'
}

function Post($url, $body, $session) {
  $json = $body | ConvertTo-Json -Compress
  $p = @{ Uri = $url; Method = 'Post'; Body = [Text.Encoding]::UTF8.GetBytes($json); ContentType = 'application/json'; Headers = $headers }
  if ($session) { $p.WebSession = $session }
  try { Invoke-RestMethod @p }
  catch {
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    throw "Bambu respondio: $msg"
  }
}

try {
  $email = (Read-Host 'Email de tu cuenta Bambu Lab').Trim()
  $sec = Read-Host 'Contrasena (no se ve al escribir)' -AsSecureString
  $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

  $r = Post "$api/user/login" @{ account = $email; password = $pass; apiError = '' }
  $token = $r.accessToken

  if (-not $token -and $r.loginType -eq 'verifyCode') {
    Post "$api/user/sendemail/code" @{ email = $email; type = 'codeLogin' } | Out-Null
    $code = (Read-Host 'Te ha llegado un codigo por email. Escribelo').Trim()
    $r = Post "$api/user/login" @{ account = $email; code = $code }
    $token = $r.accessToken
  }

  if (-not $token -and $r.loginType -eq 'tfa') {
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    Invoke-WebRequest -Uri 'https://bambulab.com/api/csrf' -WebSession $s -Headers $headers -UseBasicParsing | Out-Null
    $csrf = ($s.Cookies.GetCookies('https://bambulab.com') | Where-Object Name -eq 'bbl_csrf_token').Value
    $headers['x-bbl-csrf-token'] = $csrf
    $code = (Read-Host 'Codigo de tu app de verificacion en dos pasos').Trim()
    Post 'https://bambulab.com/api/sign-in/tfa' @{ tfaKey = $r.tfaKey; tfaCode = $code } $s | Out-Null
    $token = ($s.Cookies.GetCookies('https://bambulab.com') | Where-Object Name -eq 'token').Value
  }

  if (-not $token) { throw "No llego token. Respuesta: $($r | ConvertTo-Json -Compress)" }

  Set-Clipboard -Value $token
  Write-Host ''
  Write-Host 'OK. Token copiado al portapapeles (dura unos 3 meses).' -ForegroundColor Green
  Write-Host 'Pegalo en GitHub: tu repositorio > Settings > Secrets and variables > Actions > BAMBU_TOKEN'
}
catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Revisa email, contrasena o codigo y vuelve a intentarlo.'
}
Write-Host ''
Read-Host 'Pulsa Enter para cerrar' | Out-Null
