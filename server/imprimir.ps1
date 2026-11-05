# Usado pelo servidor (server/printing.js) para falar com as impressoras do Windows.
#   -Mode list : lista as impressoras e os papeis de cada uma, em JSON
#   -Mode print: imprime preenchendo a folha toda, como o app da Kodak, sem dialogo
# Fica so em ASCII: o PowerShell do Windows le arquivos sem BOM como ANSI.
param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'print')][string]$Mode,
  [string]$Printer,
  [int]$PaperIndex = -1,
  [string]$Image
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

try {
  Add-Type -AssemblyName System.Drawing

  if ($Mode -eq 'list') {
    $default = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
    # ArrayList, e nao @(), para lista vazia ou de um item virar array no JSON
    $printers = New-Object System.Collections.ArrayList
    foreach ($name in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
      $settings = New-Object System.Drawing.Printing.PrinterSettings
      $settings.PrinterName = $name
      $papers = New-Object System.Collections.ArrayList
      $index = 0
      foreach ($paper in $settings.PaperSizes) {
        [void]$papers.Add([pscustomobject]@{ index = $index; name = $paper.PaperName; width = $paper.Width; height = $paper.Height })
        $index++
      }
      [void]$printers.Add([pscustomobject]@{ name = $name; isDefault = ($name -eq $default); papers = $papers })
    }
    ConvertTo-Json -InputObject $printers -Depth 4 -Compress
    exit 0
  }

  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $Printer
  if (-not $doc.PrinterSettings.IsValid) { throw "Impressora nao encontrada: $Printer" }
  $papers = $doc.PrinterSettings.PaperSizes
  if ($PaperIndex -lt 0 -or $PaperIndex -ge $papers.Count) { throw "Papel invalido: $PaperIndex" }

  $script:photo = [System.Drawing.Image]::FromFile($Image)
  try {
    $doc.DocumentName = 'Papai Noel'
    $page = $doc.DefaultPageSettings
    $page.PaperSize = $papers[$PaperIndex]
    $page.Landscape = $script:photo.Width -gt $script:photo.Height
    $page.Margins = New-Object System.Drawing.Printing.Margins 0, 0, 0, 0
    # Sem a janelinha "Imprimindo pagina 1"
    $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

    $doc.add_PrintPage({
      param($sender, $e)
      $img = $script:photo
      $bounds = $e.PageBounds
      # Max preenche a folha (corta o excesso no centro, sem faixas brancas); Min caberia inteira.
      $scale = [Math]::Max($bounds.Width / $img.Width, $bounds.Height / $img.Height)
      $w = $img.Width * $scale
      $h = $img.Height * $scale
      # O desenho comeca na area imprimivel; desconta a margem fisica para centralizar na folha.
      $x = ($bounds.Width - $w) / 2 - $e.PageSettings.HardMarginX
      $y = ($bounds.Height - $h) / 2 - $e.PageSettings.HardMarginY
      $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $e.Graphics.DrawImage($img, [single]$x, [single]$y, [single]$w, [single]$h)
      $e.HasMorePages = $false
    })
    $doc.Print()
  } finally {
    $script:photo.Dispose()
    $doc.Dispose()
  }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
