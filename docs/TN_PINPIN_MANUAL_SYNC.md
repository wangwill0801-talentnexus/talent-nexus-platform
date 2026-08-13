# Manual Pinpin to Talent Nexus Sync

Run this command only on the VPS as an authorized administrator:

```powershell
Set-Location E:\TalentNexus\tn-api
npm run pinpin:sync:manual
```

Exit code `0` means the full read-only Option C reconciliation completed and
the lightweight integrity gate passed. Any non-zero exit code means do not
retry concurrently; review the sanitized command output and the `sync_runs` /
`sync_errors` ledger first.

The command loads only the existing protected configuration files, takes a
PostgreSQL advisory lock, preflights PostgreSQL and the Pinpin Shared
Memory/LPC source connection, then calls the existing full reconciler. It is
intentionally manual: no scheduler exists. Pinpin remains read-only and no
resume BLOB content is read.
