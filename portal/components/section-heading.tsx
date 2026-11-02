export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  id,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  id?: string;
}) {
  return (
    <div className="section-heading">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
    </div>
  );
}