# Generates misc\GitMob.ico — a rounded git-orange tile with a big "G".
# Re-run after changing the letter/color, then re-run Create-Shortcut.ps1
# (Windows caches icons; refreshing the shortcut picks up the new one).
Add-Type -AssemblyName System.Drawing
function New-AppIcon([string]$Path,[string]$Letter,[string]$HexBg){
  $size = 256
  $bmp = New-Object System.Drawing.Bitmap($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = [System.Drawing.ColorTranslator]::FromHtml($HexBg)
  $brush = New-Object System.Drawing.SolidBrush($bg)
  $pad = 16; $radius = 48; $d = $radius*2
  $x=$pad; $y=$pad; $w=$size-2*$pad; $h=$size-2*$pad
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc($x,$y,$d,$d,180,90)
  $gp.AddArc($x+$w-$d,$y,$d,$d,270,90)
  $gp.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90)
  $gp.AddArc($x,$y+$h-$d,$d,$d,90,90)
  $gp.CloseFigure()
  $g.FillPath($brush,$gp)
  $font = New-Object System.Drawing.Font("Segoe UI",140,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment=[System.Drawing.StringAlignment]::Center; $sf.LineAlignment=[System.Drawing.StringAlignment]::Center
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.DrawString($Letter,$font,$white,(New-Object System.Drawing.RectangleF(0,4,$size,$size)),$sf)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray(); $ms.Dispose(); $bmp.Dispose()
  $fs = [System.IO.File]::Create($Path); $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)         # ICONDIR: reserved, type=icon, count=1
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)  # 256x256 (0=256), colors, reserved
  $bw.Write([uint16]1); $bw.Write([uint16]32)                              # planes, bpp
  $bw.Write([uint32]$png.Length); $bw.Write([uint32]22); $bw.Write($png)   # size, offset(6+16), data
  $bw.Flush(); $bw.Dispose(); $fs.Dispose()
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
# Output filename, letter, color (hex). #F05133 is Git's brand orange-red.
New-AppIcon (Join-Path $dir "GitMob.ico") "G" "#F05133"
Write-Host "Wrote $dir\GitMob.ico"
