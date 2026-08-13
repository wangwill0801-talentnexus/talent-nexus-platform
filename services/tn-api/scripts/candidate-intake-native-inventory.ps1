$ErrorActionPreference='Stop'
Get-ChildItem -LiteralPath 'E:\TalentNexus' -Directory |
  Where-Object Name -Like 'tn-api.pre-candidate-intake-*' |
  Select-Object -ExpandProperty FullName
Get-ChildItem -LiteralPath 'E:\TalentNexus\tn-api\node_modules\msnodesqlv8' -Recurse -Filter 'sqlserver.node' -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName
Get-ChildItem -Path 'E:\TalentNexus\tn-api.pre-candidate-intake-*\node_modules\msnodesqlv8' -Recurse -Filter 'sqlserver.node' -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName
