/**
 * Parse, format, and validate the contact line. The same rules keep email and LinkedIn requirements consistent wherever a resume is prepared.
 */
export type ResumeContact = {
  email: string;
  linkedin: string;
  other: string;
};
export function parseResumeContact(value: string): ResumeContact {
  const email = value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const linkedin = value.match(/(?:https?:\/\/)?(?:[a-z]+\.)?linkedin\.com\/in\/[^\s·|,]+/i)?.[0] ?? "";
  const other = value.replace(email, "").replace(linkedin, "").replace(/^[\s·|,]+|[\s·|,]+$/g, "").trim();
  return {
    email,
    linkedin,
    other
  };
}
export function formatResumeContact(value: ResumeContact): string {
  return [value.email.trim(), value.linkedin.trim(), value.other.trim()].filter(Boolean).join(" · ");
}
export function contactIssues(value: string): string[] {
  const contact = parseResumeContact(value);
  const issues: string[] = [];
  if (!contact.email) issues.push("Add a valid contact email before exporting.");
  let linkedInValid = false;
  try {
    const url = new URL(contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}`);
    linkedInValid = ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) && /^\/in\/[^/]+\/?$/.test(url.pathname);
  } catch {/* Missing or incomplete profile URL. */}
  if (!linkedInValid) issues.push("Add your LinkedIn profile URL before exporting.");
  return issues;
}
