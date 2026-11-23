# Le look Horizon dans le terminal.
#
# Le moteur de Claude Code ne dessine les looks que dans l'app de bureau et l'app mobile.
# Ce script donne au terminal la palette du look (pas la scène) :
#   1. ajoute le jeu de couleurs « Horizon » à Windows Terminal ;
#   2. ajoute un profil « Claude · Horizon » qui lance claude dans le dossier personnel avec ces couleurs
#      (les autres profils ne changent pas) ;
#   3. met Claude Code sur le thème « dark-ansi », qui reprend les 16 couleurs du terminal.
# Chaque fichier modifié est d'abord sauvegardé à côté (.bak-<date>). Relançable sans doublon.
# Défaire : -Uninstall (ou remettre les .bak).

param(
    [string]$TerminalSettings = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json",
    [string]$ClaudeSettings = "$env:USERPROFILE\.claude\settings.json",
    [string]$ClaudeTheme = 'dark-ansi',
    [string]$PreviousClaudeTheme = 'dark',
    [switch]$SkipClaudeTheme,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$SchemeName = 'Horizon'
$ProfileGuid = '{3f1a5e2c-9b7d-4c61-8e0a-150150a0b0c7}'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'

# Palette du look horizon (hooks/horizon.ts) ; bleu, cyan et les « bright » sont ajoutés.
$Scheme = [ordered]@{
    name                = $SchemeName
    background          = '#14162B'   # surface-0
    foreground          = '#EFE6D0'   # text-primary
    cursorColor         = '#E07A62'   # accent
    selectionBackground = '#2E3358'
    black               = '#20233F'   # surface-3
    red                 = '#EF4F4F'   # danger
    green               = '#8FC79A'   # success
    yellow              = '#E8B45A'   # warning
    blue                = '#7D8FD9'
    purple              = '#A99CF0'   # pro
    cyan                = '#6FC1C4'
    white               = '#CFC6B2'   # text-secondary
    brightBlack         = '#A8A08F'   # text-muted
    brightRed           = '#F47A6A'
    brightGreen         = '#B5DCBC'
    brightYellow        = '#F2CF8A'
    brightBlue          = '#A5B2EC'
    brightPurple        = '#C9C0F7'
    brightCyan          = '#9AD7D9'
    brightWhite         = '#EFE6D0'
}

$WtProfile = [ordered]@{
    guid              = $ProfileGuid
    name              = 'Claude · Horizon'
    commandline       = 'pwsh.exe -NoLogo -NoExit -Command claude'
    startingDirectory = '%USERPROFILE%'
    colorScheme       = $SchemeName
    hidden            = $false
}

function Save-Backup([string]$Path) {
    $bak = "$Path.bak-$Stamp"
    if (Test-Path -LiteralPath $bak) { throw "La sauvegarde existe déjà : $bak" }
    Copy-Item -LiteralPath $Path -Destination $bak
    Write-Host "Sauvegarde : $bak"
}

# --- Windows Terminal ---
if (-not (Test-Path -LiteralPath $TerminalSettings)) { throw "Introuvable : $TerminalSettings" }
Save-Backup $TerminalSettings
$wt = Get-Content -LiteralPath $TerminalSettings -Raw | ConvertFrom-Json -Depth 50
$schemes = @($wt.schemes | Where-Object { $_ -and $_.name -ne $SchemeName })
$profiles = @($wt.profiles.list | Where-Object { $_.guid -ne $ProfileGuid })
if (-not $Uninstall) {
    $schemes += [pscustomobject]$Scheme
    $profiles += [pscustomobject]$WtProfile
}
$wt.schemes = $schemes
$wt.profiles.list = $profiles
ConvertTo-Json -InputObject $wt -Depth 50 | Set-Content -LiteralPath $TerminalSettings -Encoding utf8NoBOM
Write-Host ($Uninstall ? "Windows Terminal : jeu « $SchemeName » et profil retirés." : "Windows Terminal : jeu « $SchemeName » et profil « Claude · Horizon » en place.")

# --- Claude Code ---
if (-not $SkipClaudeTheme) {
    if (-not (Test-Path -LiteralPath $ClaudeSettings)) { throw "Introuvable : $ClaudeSettings" }
    Save-Backup $ClaudeSettings
    $cc = Get-Content -LiteralPath $ClaudeSettings -Raw | ConvertFrom-Json -Depth 50 -AsHashtable
    $cc['theme'] = $Uninstall ? $PreviousClaudeTheme : $ClaudeTheme
    ConvertTo-Json -InputObject $cc -Depth 50 | Set-Content -LiteralPath $ClaudeSettings -Encoding utf8NoBOM
    Write-Host "Claude Code : thème « $($cc['theme']) »."
}

