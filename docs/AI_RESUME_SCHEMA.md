# Standard Resume JSON Schema

Single source of truth, mirrored across:
- `working/js/versions/v1/sites/tnai-schema.js` (window.TNAI_SCHEMA.JSON_SCHEMA)
- `dist/ai-page-netlify/lib/resume-schema.mjs` (STANDARD_RESUME_JSON_SCHEMA)

Fields: candidate{name,phone,email,location}, currentEmployment{company,title},
experience[]{company,title,startDate,endDate,isCurrent,description},
education[]{school,degree,major,startDate,endDate},
skills[], languages[], certifications[], jobPreferences, summary.

No-hallucination rule: missing → null (string) / [] (array). Gemini uses
responseSchema (structured output); backend re-validates before returning.
