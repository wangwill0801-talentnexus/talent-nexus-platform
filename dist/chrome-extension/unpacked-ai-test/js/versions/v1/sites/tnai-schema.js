/*
 * window.TNAI_SCHEMA — single source of truth for the Standard Resume JSON.
 *
 * This exact field set is mirrored by the Netlify backend
 * (ai-page-netlify/lib/resume-schema.mjs) so the Chrome extension and the
 * hosted test page speak ONE data model. If you change a field here, change it
 * there and in the Gemini responseSchema.
 *
 * Privacy: this module contains NO candidate values. The mock sample below is
 * fully anonymized and uses non-allocated phone patterns and example.invalid.
 */
(function (global) {
  'use strict';

  var STANDARD_RESUME_JSON_SCHEMA = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'StandardResume',
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

  // Anonymized Traditional-Chinese 104-style mock. Used when the backend or
  // the extension runs in AI_MOCK_MODE. Mirrors the shape the Gemini
  // structured-output call must return.
  var MOCK_RESUME = {
    candidate: {
      name: 'ANON-TEST-001',
      phone: '0910000000',
      email: 'anon.test-001@example.invalid',
      location: 'New Taipei City'
    },
    currentEmployment: { company: 'Example Corp', title: 'FAE Application Engineer' },
    experience: [
      {
        company: 'Example Corp',
        title: 'FAE Application Engineer',
        startDate: '2019/03',
        endDate: null,
        isCurrent: true,
        description: 'Led industrial-automation project rollouts and customer technical support.'
      },
      {
        company: 'Sample Systems Inc',
        title: 'Software Engineer',
        startDate: '2014/07',
        endDate: '2019/02',
        isCurrent: false,
        description: 'Backend service development and operations.'
      }
    ],
    education: [
      { school: 'Example University', degree: 'Bachelor', major: 'Information Management', startDate: '2010/09', endDate: '2014/06' }
    ],
    skills: ['JavaScript', 'Python', 'SQL'],
    languages: ['Chinese', 'English'],
    certifications: [],
    jobPreferences: 'Preferred title: System Maintenance Engineer',
    summary: '11-12 years in IT; industrial automation and software development.'
  };

  global.TNAI_SCHEMA = {
    JSON_SCHEMA: STANDARD_RESUME_JSON_SCHEMA,
    MOCK_RESUME: MOCK_RESUME,
    // Empty canvas for the editor before any parse.
    empty: function () {
      return {
        candidate: { name: null, phone: null, email: null, location: null },
        currentEmployment: { company: null, title: null },
        experience: [],
        education: [],
        skills: [], languages: [], certifications: [],
        jobPreferences: null, summary: null
      };
    }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
