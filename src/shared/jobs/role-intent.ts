/**
 * Clarify broad function choices and reject obvious title conflicts.
 * Deep interprets the complete request; company and location words are not title keywords.
 */
type RoleFamily = {
  request: RegExp;
  title: RegExp;
  vocabulary: string[];
};
function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\bfront[ -]end\b/g, "frontend").replace(/\bback[ -]end\b/g, "backend").replace(/\bfull[ -]stack\b/g, "fullstack").replace(/\bdev[ -]rel\b/g, "devrel").replace(/\bartificial intelligence\b/g, "ai").replace(/[^\p{L}\p{N}+#]+/gu, " ").replace(/\s+/g, " ").trim();
}
const productManagement = /\bproduct (?:managers?|leads?|leaders?|owners?)\b|\b(?:head|director|manager|vp|vice president|chief|lead) (?:of )?product(?:s| management)?\b(?! (?:market(?:ing|er)|design(?:er|ing)?|engineer(?:ing)?|sales|support|operations)\b)|\bchief product officer\b/;
const productMarketing = /\bproduct market(?:ing|er)\b/;
const productDesign = /\bproduct (?:ux |ui )?design(?:er|ing)?\b/;
const productEngineering = /\bproduct engineer(?:ing)?\b|\b(?:software |fullstack |frontend |backend )?engineer(?:ing)? product\b/;
const devrel = /\bdevrel\b|\bdeveloper (?:relations|advocacy|advocates?|evangelism|evangelists?)\b/;

// This is only a conservative guard for short, standalone function requests.
// Rich or unfamiliar requests need Deep's reading of the actual posting.
const families: RoleFamily[] = [{
  request: new RegExp(`${productManagement.source}|\\bproduct management\\b|^pm$`),
  title: productManagement,
  vocabulary: ["product", "products", "manager", "managers", "management", "owner", "owners", "leader", "leaders", "officer", "pm"]
}, {
  request: productMarketing,
  title: productMarketing,
  vocabulary: ["product", "marketing", "marketer", "manager", "management"]
}, {
  request: productDesign,
  title: productDesign,
  vocabulary: ["product", "design", "designer", "designing"]
}, {
  request: productEngineering,
  title: productEngineering,
  vocabulary: ["product", "engineer", "engineering"]
}, {
  request: devrel,
  title: devrel,
  vocabulary: ["devrel", "developer", "relations", "advocate", "advocacy", "evangelist", "evangelism"]
}, {
  request: /\bdata scien(?:ce|tist)\b/,
  title: /\bdata scien(?:ce|tist)\b/,
  vocabulary: ["data", "science", "scientist"]
}, {
  request: /\bdata (?:analys(?:is|t)|analytics)\b/,
  title: /\bdata (?:analyst|analytics|analysis)\b|\banalytics (?:engineer|manager|lead)\b/,
  vocabulary: ["data", "analyst", "analysis", "analytics"]
}, {
  request: /\bproject (?:manager|management)\b/,
  title: /\bproject (?:manager|management|lead|director)\b/,
  vocabulary: ["project", "manager", "management"]
}, {
  request: /\bprogram (?:manager|management)\b/,
  title: /\bprogram (?:manager|management|lead|director)\b/,
  vocabulary: ["program", "manager", "management"]
}, {
  request: /\b(?:software|frontend|backend|fullstack|web|mobile) (?:engineer|engineering|developer|development)\b|\bswe\b|^developer$/,
  title: /\b(?:software|frontend|backend|fullstack|web|mobile) (?:engineer|engineering|developer|development)\b|\bswe\b|\b(?:frontend|backend|fullstack) developer\b/,
  vocabulary: ["software", "frontend", "backend", "fullstack", "web", "mobile", "engineer", "engineering", "developer", "development", "swe"]
}, {
  request: /\bengineer(?:ing)?\b/,
  title: /\bengineer(?:ing)?\b/,
  vocabulary: ["engineer", "engineering"]
}, {
  request: /\bdesign(?:er|ing)?\b/,
  title: /\bdesign(?:er|ing)?\b/,
  vocabulary: ["design", "designer", "designing"]
}, {
  request: /\bmarket(?:ing|er)\b/,
  title: /\bmarket(?:ing|er)\b/,
  vocabulary: ["marketing", "marketer"]
}, {
  request: /\bsales\b|\baccount executive\b|\bbusiness development\b|^sdr$|^bdr$/,
  title: /\bsales\b|\baccount executive\b|\bbusiness development\b|\bsdr\b|\bbdr\b/,
  vocabulary: ["sales", "account", "executive", "business", "development", "sdr", "bdr"]
}, {
  request: /\bcustomer success\b/,
  title: /\bcustomer success\b/,
  vocabulary: ["customer", "success", "manager", "management"]
}];
const filler = new Set(["senior", "sr", "junior", "jr", "staff", "principal", "lead", "head", "director", "manager", "managers", "management", "vp", "vice", "president", "chief", "executive", "entry", "level", "of", "the", "a", "an", "in", "at", "for", "as", "to", "and", "role", "roles", "job", "jobs", "position", "positions", "looking", "seeking", "open"]);
function unrestricted(input: string): boolean {
  return /^(?:any|all) (?:roles?|jobs?|opportunities)$/.test(input) || /^open to (?:(?:suitable|any|all|different|new) )?(?:roles?|jobs?|opportunities|options)\b/.test(input) || /^(?:no preference|anything suitable)$/.test(input);
}
function isBroadProduct(input: string): boolean {
  return /^(?:all )?product(?: roles?| jobs?| positions?)?$/.test(input);
}
export function clarifyTargetRole(input: string): {
  question: string;
  options: string[];
} | null {
  const request = normalize(input).replace(/^(?:i am |i m )?(?:looking for |seeking |open to )/, "").replace(/^(?:a|an) /, "");
  if (request.startsWith("all product")) return null;
  if (!isBroadProduct(request) && !/^pm(?: roles?| jobs?| positions?)?$/.test(request)) return null;
  return {
    question: "Which product roles?",
    options: ["Product management", "Product marketing", "Product design", "Product engineering", "All product roles"]
  };
}
function meaningfulWords(value: string, omit: string[] = []): string[] {
  const excluded = new Set(omit);
  return [...new Set(value.split(" ").filter(word => word && !filler.has(word) && !excluded.has(word)))];
}
function matchesOne(title: string, requested: string): boolean {
  const request = normalize(requested).replace(/^(?:i am |i m )?(?:looking for |seeking |open to )/, "");
  if (!request) return false;
  if (unrestricted(normalize(requested))) return true;
  // Context clauses can contain role words as company names ("jobs at Sales").
  // Even a familiar word must not become a function constraint in that case.
  if (/\b(?:at|for|in|near|within|outside|except|excluding|without|not|prefer|ideally)\b/.test(request)) return true;
  if (isBroadProduct(request)) {
    return !devrel.test(title) && !/\b(?:sales|account executive)\b/.test(title);
  }
  const family = families.find(item => item.request.test(request));
  const required = meaningfulWords(request, family?.vocabulary);
  if (!family && !required.length) return false;
  // Extra words may express a company, location, preference, negation or domain.
  // Do not guess what they mean, or require them to appear in the job title.
  if (!family || required.length) return true;
  if (devrel.test(title) && family.title !== devrel) return false;
  if (/\bbackend\b/.test(request) && /\bfrontend\b/.test(title) && !/\b(?:backend|fullstack)\b/.test(title)) return false;
  if (/\bfrontend\b/.test(request) && /\bbackend\b/.test(title) && !/\b(?:frontend|fullstack)\b/.test(title)) return false;
  if (family.title.test(title)) return true;
  const productFunctions = [productManagement, productMarketing, productDesign, productEngineering];
  if (productFunctions.includes(family.title) && productFunctions.some(pattern => pattern.test(title))) return false;
  if (family.title === devrel && productFunctions.some(pattern => pattern.test(title))) return false;
  if ((family.title === productManagement || family.title === devrel) && /\b(?:sales|account executive)\b/.test(title)) return false;
  if (/\bdata (?:analysis|analyst|analytics)\b/.test(request) && /\bdata scientist\b/.test(title)) return false;
  if (/\bdata (?:science|scientist)\b/.test(request) && /\bdata analyst\b/.test(title)) return false;
  // Other titles can overlap functions: a Developer Experience Engineer may do
  // DevRel. Let Deep read the duties instead of extending a list of title aliases.
  return true;
}
export function matchesTargetRole(title: string, requested: string): boolean {
  const actual = normalize(title);
  if (!actual || !requested.trim()) return false;
  if (unrestricted(normalize(requested))) return true;
  return requested.split(/\s+or\s+|[,;|]|\s*\/\s*/i).some(alternative => matchesOne(actual, alternative));
}
