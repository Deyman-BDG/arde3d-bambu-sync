# Renueva el token de Bambu y lo guarda en GitHub sin tener que pegarlo a mano.
# Uso: .\renovar-token.ps1            (cuenta de David -> BAMBU_TOKEN)
#      .\renovar-token.ps1 BAMBU_TOKEN_2   (cuenta del socio)
param([string]$Secreto = 'BAMBU_TOKEN')
$gh = 'C:\Program Files\GitHub CLI\gh.exe'
Set-Clipboard -Value ' '
& "$PSScriptRoot\login.ps1"
$t = (Get-Clipboard | Out-String).Trim()
if ($t.Length -lt 20) { Write-Host 'No se ha guardado nada: no hay token nuevo.' -ForegroundColor Red; exit 1 }
$t | & $gh secret set $Secreto --repo Deyman-BDG/arde3d-bambu-sync
Set-Clipboard -Value ' '
if ($LASTEXITCODE -eq 0) { Write-Host "Guardado en GitHub como $Secreto." -ForegroundColor Green }
