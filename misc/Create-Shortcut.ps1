# Creates / refreshes the "GitMob" shortcut in the project root, pointing at
# misc\GitMob.vbs and carrying the icon. Re-run after moving/renaming the folder
# (.lnk files store ABSOLUTE paths) or after regenerating the icon.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition   # ...\misc
$root = Split-Path -Parent $scriptDir
$lnk = Join-Path $root "GitMob.lnk"

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
# Run the .vbs through wscript explicitly: no console, no file-association surprises.
$sc.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$sc.Arguments  = '"' + (Join-Path $scriptDir "GitMob.vbs") + '"'
$sc.WorkingDirectory = $root
$sc.IconLocation = (Join-Path $scriptDir "GitMob.ico") + ",0"
$sc.Description = "Launch GitMob (system tray)"
$sc.Save()
Write-Host "Created shortcut: $lnk"
