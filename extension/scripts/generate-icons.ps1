
$ErrorActionPreference = "Stop"

$Repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Icons = Join-Path $Repo "extension\icons"

New-Item -ItemType Directory -Path $Icons -Force | Out-Null

Add-Type -AssemblyName System.Drawing

$Roles = @{
    publisher  = "#16834A"
    subscriber = "#2563EB"
    neutral    = "#64748B"
}

foreach ($Role in $Roles.Keys) {
    foreach ($Size in @(16, 32, 48, 128)) {

        $Bitmap = [System.Drawing.Bitmap]::new($Size, $Size)
        $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)

        try {
            $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

            $Color = [System.Drawing.ColorTranslator]::FromHtml($Roles[$Role])
            $Graphics.Clear($Color)

            $Scale = $Size / 64.0
            $Graphics.ScaleTransform($Scale, $Scale)

            $Pen = [System.Drawing.Pen]::new(
                [System.Drawing.Color]::White,
                5
            )

            try {
                $Pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
                $Pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

                $Graphics.DrawArc($Pen, 15, 15, 34, 34, 210, 160)
                $Graphics.DrawArc($Pen, 15, 15, 34, 34, 30, 160)
            }
            finally {
                $Pen.Dispose()
            }

            $Output = Join-Path $Icons "$Role-$Size.png"

            $Bitmap.Save(
                $Output,
                [System.Drawing.Imaging.ImageFormat]::Png
            )

            Write-Host "Generado: $Output"
        }
        finally {
            $Graphics.Dispose()
            $Bitmap.Dispose()
        }
    }
}
