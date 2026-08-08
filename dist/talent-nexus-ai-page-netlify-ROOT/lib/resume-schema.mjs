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
    summary: { type: ['string', 'null'] }
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
      summary: { type: 'string' }
    },
    required: ['candidate', 'currentEmployment', 'experience', 'education', 'skills', 'languages', 'certifications', 'summary'],
    propertyOrdering: ['candidate', 'currentEmployment', 'experience', 'education', 'skills', 'languages', 'certifications', 'jobPreferences', 'summary']
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
  summary: '11-12 years in IT; industrial automation and software development.'
};
