/**
 * Controlled recruiting taxonomy used by the TN search read model.
 *
 * This expands recruiter terminology only while matching. It never adds
 * facts to a candidate profile or changes the evidence returned to a user.
 */
type AliasGroup = {
  family: string;
  aliases: readonly string[];
};

const ALIAS_GROUPS: readonly AliasGroup[] = [
  {
    family: 'ee-hardware',
    aliases: [
      'EE', 'Electrical Engineer', 'Electronics Engineer', 'Electronic Engineer',
      'Hardware', 'Hardware Engineer', 'Hardware Design Engineer', 'Board-level EE',
      '電子工程師', '電機工程師', '硬體工程師', '硬體研發工程師',
      '硬體設計工程師', '電路設計工程師'
    ]
  },
  {
    family: 'rf',
    aliases: ['RF', 'RF Engineer', 'RF Hardware', 'RF Design', '射頻工程師']
  },
  {
    family: 'firmware',
    aliases: ['FW', 'Firmware Engineer', 'Embedded Firmware', '韌體工程師', '嵌入式']
  },
  {
    family: 'project-program',
    aliases: ['PM', 'Project Manager', 'Program Manager', '專案經理']
  },
  {
    family: 'sales',
    aliases: ['Sales', 'Sales Engineer', 'Account Manager', 'Business Development', '業務', '業務工程師']
  },
  {
    family: 'erp',
    aliases: ['ERP', 'ERP Engineer', 'ERP Consultant', 'ERP 系統工程師']
  },
  {
    family: 'wifi-bluetooth',
    aliases: ['WiFi Bluetooth', 'WIFI-BT']
  },
  {
    family: 'bluetooth',
    aliases: ['Bluetooth', 'Bluetooth Module', 'WIFI-BT', 'WiFi Bluetooth']
  },
  {
    family: 'wifi',
    aliases: ['WiFi', 'Wi-Fi', 'WIFI-BT', 'WiFi Bluetooth']
  },
  {
    family: 'micron',
    aliases: ['Micron', 'Micron Technology', '美光']
  },
  {
    family: 'qualcomm-platform',
    aliases: ['Qualcomm', 'Qualcomm 8X09', 'Qualcomm 8X53', 'Qualcomm 8X96', '8X09', '8X53', '8X96']
  }
];

const ROLE_FAMILIES = new Set(['ee-hardware', 'rf', 'firmware', 'project-program', 'sales', 'erp']);

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s_\-/]+/g, ' ')
    .replace(/[，。；：、（）()【】［］,[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function hasPhrase(haystack: string, phrase: string): boolean {
  const needle = normalizeSearchText(phrase);
  if (!needle) return false;
  // Chinese aliases are naturally substring searchable. Latin acronyms and
  // words use boundaries so EE does not match unrelated words such as sleep.
  if (/^[a-z0-9 .]+$/i.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(haystack);
  }
  return haystack.includes(needle);
}

export function aliasGroupForTerm(term: string): AliasGroup | null {
  const normalized = normalizeSearchText(term);
  const compactTerm = compact(term);
  if (!normalized) return null;
  return ALIAS_GROUPS.find((group) => group.aliases.some((alias) => {
    const aliasNormalized = normalizeSearchText(alias);
    return compactTerm === compact(alias) || hasPhrase(normalized, aliasNormalized);
  })) ?? null;
}

export function aliasesForTerm(term: string): readonly string[] {
  return aliasGroupForTerm(term)?.aliases ?? [term];
}

export function isRoleTerm(term: string): boolean {
  const group = aliasGroupForTerm(term);
  return Boolean(group && ROLE_FAMILIES.has(group.family));
}

/** Match one requested criterion against one evidence surface. */
export function matchesSearchTerm(haystack: string, term: string): boolean {
  const normalizedHaystack = normalizeSearchText(haystack);
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedHaystack || !normalizedTerm) return false;
  const group = aliasGroupForTerm(term);
  // A compound request such as "Qualcomm Hardware" or "WiFi Bluetooth EE"
  // contains multiple independent signals. Match the role family and the
  // remaining evidence terms instead of treating the whole phrase as one
  // role alias. Common seniority modifiers are intentionally non-blocking.
  if (normalizedTerm.includes(' ') && group) {
    const matchedAlias = group.aliases
      .filter((alias) => hasPhrase(normalizedTerm, alias))
      .sort((a, b) => normalizeSearchText(b).length - normalizeSearchText(a).length)[0];
    if (matchedAlias && normalizeSearchText(matchedAlias) !== normalizedTerm) {
      const residue = normalizedTerm.replace(normalizeSearchText(matchedAlias), ' ').trim();
      const modifiers = new Set(['senior', 'lead', 'principal', 'staff', 'junior', '資深', '主任', '高級']);
      const residueTerms = residue.split(' ').filter((part) => part.length >= 2 && !modifiers.has(part));
      const roleEvidence = group.aliases.some((alias) => hasPhrase(normalizedHaystack, alias));
      return roleEvidence
        && residueTerms.every((part) => matchesSearchTerm(normalizedHaystack, part));
    }
  }
  if (group?.family === 'wifi-bluetooth') {
    return group.aliases.some((alias) => hasPhrase(normalizedHaystack, alias));
  }
  if (group) return group.aliases.some((alias) => hasPhrase(normalizedHaystack, alias));
  if (hasPhrase(normalizedHaystack, term)) return true;

  // Natural-language criteria such as "Micron 客戶經驗" are not required to
  // appear as one exact phrase. Keep the requirement evidence-backed by
  // requiring each meaningful token, rather than relaxing it to any one word.
  const parts = normalizeSearchText(term).split(' ').filter((part) => part.length >= 2);
  return parts.length > 1 && parts.every((part) => hasPhrase(normalizedHaystack, part));
}

export function matchesCustomerExperience(haystack: string, term: string): boolean {
  const normalized = normalizeSearchText(term);
  const customerMarker = /(客戶|customer|client|account)/i.test(normalized);
  if (!customerMarker) return false;
  const company = aliasGroupForTerm(term.split(/客戶|customer|client|account/i)[0] ?? '');
  const companyAliases = company?.family === 'micron' ? company.aliases : [term.split(/客戶|customer|client|account/i)[0] ?? ''];
  const hasCompany = companyAliases.some((alias) => matchesSearchTerm(haystack, alias));
  const evidenceContext = /(客戶|customer|client|account|project|專案|服務|支援|support)/i.test(normalizeSearchText(haystack));
  return hasCompany && evidenceContext;
}

export function matchesEvidence(haystack: string, term: string): boolean {
  return matchesCustomerExperience(haystack, term) || matchesSearchTerm(haystack, term);
}
