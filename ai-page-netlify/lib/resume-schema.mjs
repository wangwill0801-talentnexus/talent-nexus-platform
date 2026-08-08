// ai-page-netlify/lib/resume-schema.mjs
// Single source of truth for the Standard Resume JSON (mirror of the Chrome
// extension's window.TNAI_SCHEMA.JSON_SCHEMA). Keep field names identical
// across both sides.
export const STANDARD_RESUME_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: ['candidate'],
  properties: {
    candidate: {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        email: { type: ['string', 'null'] },
        location: { type: ['string', 'null'] }
      }
    },
    currentEmployment: {
      type: ['object', 'null'],
      properties: {
        company: { type: ['string', 'null'] },
        title: { type: ['string', 'null'] }
      }
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
          startDate: { type: ['string', 'null'] },
          endDate: { type: ['string', 'null'] },
          isCurrent: { type: 'boolean' },
          description: { type: ['string', 'null'] }
        }
      }
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          school: { type: ['string', 'null'] },
          degree: { type: ['string', 'null'] },
          major: { type: ['string', 'null'] },
          startDate: { type: ['string', 'null'] },
          endDate: { type: ['string', 'null'] }
        }
      }
    },
    skills: { type: 'array', items: { type: 'string' } },
    languages: { type: 'array', items: { type: 'string' } },
    certifications: { type: 'array', items: { type: 'string' } },
    jobPreferences: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
    targetRoles: {
      type: 'array',
      description: '3-7 realistic recruiter-searchable target role titles derived from CAREER EVIDENCE (function/skills/seniority/industry), NOT the candidates desired titles verbatim. Do not over-promote.'
    },
    recruiterSummary: {
      type: ['string', 'null'],
      description: '2-4 concise THIRD-PERSON recruiter-intelligence sentences: career positioning, seniority, industries/domains, core function, concrete technical/product/project/customer/management evidence, differentiation, realistic next-step roles. Never first-person. Never just "<title> @ <company>. X years". Output Traditional Chinese by default; keep industry-standard English terms.'
    },
    coreKeywords: {
      type: 'array',
      description: '10-18 high-value ATS sourcing keywords a recruiter would type into search: domain/function/tech/product/material/system/platform/specialized-capability/high-value tools. EXCLUDE candidate name, employer, school, location, salary, weak languages, generic office tools, generic certificates. Deduplicate case-insensitively.'
    },
    searchNote: {
      type: ['string', 'null'],
      description: 'OPTIONAL backward-compat free-form note. Prefer structured recruiterSummary/targetRoles/coreKeywords instead. If present, extension uses it only as fallback.'
    }
  }
};

// Gemini structured-output schema must be an object with a `properties` map
// and NO `required` array at the top level (Google's schema subset). We reuse
// the same shape minus JSON-Schema-only keywords.
export function toGeminiSchema() {
  return {
    type: 'object',
    properties: {
      candidate: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          location: { type: 'string' }
        },
        required: ['name', 'phone', 'email', 'location'],
        propertyOrdering: ['name', 'phone', 'email', 'location']
      },
      currentEmployment: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          title: { type: 'string' }
        },
        propertyOrdering: ['company', 'title']
      },
      experience: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company: { type: 'string' },
            title: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            isCurrent: { type: 'boolean' },
            description: { type: 'string' }
          },
          propertyOrdering: ['company', 'title', 'startDate', 'endDate', 'isCurrent', 'description']
        }
      },
      education: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            school: { type: 'string' },
            degree: { type: 'string' },
            major: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' }
          },
          propertyOrdering: ['school', 'degree', 'major', 'startDate', 'endDate']
        }
      },
      skills: { type: 'array', items: { type: 'string' } },
      languages: { type: 'array', items: { type: 'string' } },
      certifications: { type: 'array', items: { type: 'string' } },
      jobPreferences: { type: 'string' },
      summary: { type: 'string' },
      targetRoles: {
        type: 'array',
        items: { type: 'string' },
        description: '3-7 realistic recruiter-searchable target role titles derived from CAREER EVIDENCE (function/skills/seniority/industry), NOT the candidates desired titles verbatim. Do not over-promote.'
      },
      recruiterSummary: {
        type: 'string',
        description: '2-4 concise THIRD-PERSON recruiter-intelligence sentences: career positioning, seniority, industries/domains, core function, concrete technical/product/project/customer/management evidence, differentiation, realistic next-step roles. Never first-person. Never just "<title> @ <company>. X years". Output Traditional Chinese by default; keep industry-standard English terms.'
      },
      coreKeywords: {
        type: 'array',
        items: { type: 'string' },
        description: '10-18 high-value ATS sourcing keywords a recruiter would type into search: domain/function/tech/product/material/system/platform/specialized-capability/high-value tools. EXCLUDE candidate name, employer, school, location, salary, weak languages, generic office tools, generic certificates. Deduplicate case-insensitively.'
      },
      searchNote: {
        type: 'string',
        description: 'OPTIONAL backward-compat free-form note. Prefer structured recruiterSummary/targetRoles/coreKeywords. Used only as fallback by the extension.'
      }
    },
    required: ['candidate', 'currentEmployment', 'experience', 'education', 'skills', 'languages', 'certifications', 'summary', 'targetRoles', 'recruiterSummary', 'coreKeywords'],
    propertyOrdering: ['candidate', 'currentEmployment', 'experience', 'education', 'skills', 'languages', 'certifications', 'jobPreferences', 'summary', 'targetRoles', 'recruiterSummary', 'coreKeywords', 'searchNote']
  };
}

export const MOCK_RESUME = {
  candidate: { name: 'ANON-TEST-001', phone: '0910000000', email: 'anon.test-001@example.invalid', location: 'New Taipei City' },
  currentEmployment: { company: 'Example Corp', title: 'FAE Application Engineer' },
  experience: [
    { company: 'Example Corp', title: 'FAE Application Engineer', startDate: '2019/03', endDate: null, isCurrent: true, description: 'Led industrial-automation project rollouts and customer technical support.' },
    { company: 'Sample Systems Inc', title: 'Software Engineer', startDate: '2014/07', endDate: '2019/02', isCurrent: false, description: 'Backend service development and operations.' }
  ],
  education: [{ school: 'Example University', degree: 'Bachelor', major: 'Information Management', startDate: '2010/09', endDate: '2014/06' }],
  skills: ['JavaScript', 'Python', 'SQL'],
  languages: ['Chinese', 'English'],
  certifications: [],
  jobPreferences: 'Preferred title: System Maintenance Engineer',
  summary: '11-12 years in IT; industrial automation and software development.',
  targetRoles: ['ERP工程師', 'TIPTOP工程師', 'MIS工程師', '系統分析師'],
  recruiterSummary: '11年IT經驗，專精工業自動化與軟體開發，具備ERP導入與客戶技術支援能力。',
  coreKeywords: ['ERP', 'TIPTOP GP', '鼎新ERP', '工業自動化', '系統整合', 'Python', 'SQL', 'JavaScript', 'IT專案管理', '客戶技術支援'],
  searchNote: null
};
