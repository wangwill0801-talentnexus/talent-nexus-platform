# Talent Nexus Backend AI Foundation

Talent Nexus AI is internal and server-side only:

```text
TN Backend -> Gemini
```

Create the protected configuration file on the VPS at
`E:\TalentNexus\config\tn-ai.env`. Keep its ACL restricted to `Administrators`
and `SYSTEM`, consistent with the existing TN configuration files. Populate the
following values manually; do not put the API key in the repository, Plugin,
frontend, logs, or command history.

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_QUERY_MODEL=
GEMINI_REASONING_MODEL=
GEMINI_EMBEDDING_MODEL=
```

Models are configuration-driven. After an administrator enters the key and
model names, run on the VPS:

```powershell
Set-Location E:\TalentNexus\tn-api
npm run ai:check
```

The command uses only harmless synthetic text for its generation and embedding
connectivity checks. `AI NOT CONFIGURED` is expected before the administrator
adds the key and does not affect the TN API or the Phase 4 manual Pinpin sync.

Existing TNT and SOP Netlify Gemini functions are unchanged.
