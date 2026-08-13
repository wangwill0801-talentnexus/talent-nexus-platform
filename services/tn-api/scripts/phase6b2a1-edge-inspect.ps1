# Read-only Phase 6B.2A-1 infrastructure baseline. No configuration changes.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$siteBindings = foreach ($site in Get-Website) {
  foreach ($binding in Get-WebBinding -Name $site.Name) {
    [pscustomobject]@{ site = $site.Name; state = $site.State; protocol = $binding.protocol; binding = $binding.bindingInformation; sslFlags = $binding.sslFlags }
  }
}
$modules = Get-WebGlobalModule | Where-Object { $_.Name -match 'Rewrite|Proxy|Routing' } | Select-Object Name,Image
$certificates = Get-ChildItem Cert:\LocalMachine\My | Select-Object Subject,Thumbprint,NotAfter,HasPrivateKey
$listeners = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 80,443,3333,5432,1433 } | Select-Object LocalAddress,LocalPort,OwningProcess
$firewall = Get-NetFirewallRule -Enabled True -Direction Inbound | ForEach-Object {
  $rule = $_
  Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in '80','443','3333','5432','1433' } | ForEach-Object {
    [pscustomobject]@{ displayName = $rule.DisplayName; action = $rule.Action; profile = $rule.Profile; localPort = $_.LocalPort; protocol = $_.Protocol }
  }
}
$services = Get-Service W3SVC,MSSQLSERVER,postgresql-x64-17 | Select-Object Name,Status
$tnHealth = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3333/health
$pinpinZh = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:5679/webapp/
$pinpinEn = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:5678/webapp/

[pscustomobject]@{
  sites = @($siteBindings)
  modules = @($modules)
  certificates = @($certificates)
  listeners = @($listeners)
  firewall = @($firewall)
  services = @($services)
  tnHealth = $tnHealth
  pinpinZh = $pinpinZh
  pinpinEn = $pinpinEn
} | ConvertTo-Json -Depth 5 -Compress
