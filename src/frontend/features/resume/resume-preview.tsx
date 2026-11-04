/**
 * Displays the assembled resume as ordinary selectable text.
 * The same markup is printed to PDF; editing controls live in resume-screen.tsx.
 */
import type { ResumeDocument } from "@/shared/resume/document";

/** The same semantic document is used on screen and in print. Editing lives outside it. */
export function ResumeDocumentView({
  document
}: {
  document: ResumeDocument;
}) {
  const detailed = document.experience.filter(item => item.bullets.length > 0);
  const additional = document.experience.filter(item => !item.bullets.length && item.status !== "uncertain" && item.company.trim() && (item.role.trim() || item.period.trim()));
  return <article
    className="resume-paper"
    id="resume-document"
    aria-label="Resume preview"
  >
    <header className="resume-heading">
      <h2>
        {document.name}
      </h2>
      {document.contact.trim() && <p className="resume-contact-line">
        {document.contact}
      </p>}
    </header>
    {document.summary.trim() && <section className="resume-section">
      <h3>Professional summary</h3>
      <p>
        {document.summary}
      </p>
    </section>}
    {document.skills.length > 0 && <section className="resume-section resume-skills">
      <h3>Core skills</h3>
      <p>
        {document.skills.join(" · ")}
      </p>
    </section>}
    {detailed.length > 0 && <section className="resume-section">
      <h3>Professional experience</h3>
      {detailed.map(employer => <div className="resume-employer" key={employer.sourceIndex}>
        <div className="resume-employer-heading">
          <strong>
            {employer.company}
          </strong>
          {employer.period.trim() && <span>
            {employer.period}
          </span>}
        </div>
        {employer.role.trim() && <p className="resume-role-title">
          {employer.role}
        </p>}
        {employer.bullets.length > 0 && <ul className="resume-bullets">
          {employer.bullets.map((bullet, index) => <li key={`${bullet.evidenceId}-${index}`}>
            {bullet.text}
          </li>)}
        </ul>}
      </div>)}
    </section>}
    {document.selectedWork.length > 0 && <section className="resume-section">
      <h3>Selected projects & contributions</h3>
      <ul className="resume-bullets">
        {document.selectedWork.map((bullet, index) => <li key={`${bullet.evidenceId}-${index}`}>
          {bullet.text}
        </li>)}
      </ul>
    </section>}
    {additional.length > 0 && <section className="resume-section resume-earlier">
      <h3>Additional experience</h3>
      {additional.map(employer => <p key={employer.sourceIndex}>
        <strong>
          {employer.company}
        </strong>
        {employer.role.trim() && <> — {employer.role}</>}
        {employer.period.trim() && <span> · {employer.period}</span>}
      </p>)}
    </section>}
  </article>;
}
