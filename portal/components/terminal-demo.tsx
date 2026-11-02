import type { PortalContent } from "@/content/types";

export function TerminalDemo({
  terminal,
}: {
  terminal: PortalContent["terminal"];
}) {
  return (
    <figure className="terminal" aria-label="hyseed CLI example">
      <div className="terminal-titlebar" aria-hidden="true">
        <span className="terminal-dot terminal-dot-red" />
        <span className="terminal-dot terminal-dot-yellow" />
        <span className="terminal-dot terminal-dot-green" />
        <span className="terminal-title">hyseed</span>
      </div>
      <div className="terminal-body">
        <p className="terminal-command">
          <span className="terminal-prompt">$</span> {terminal.command}
          <span className="cursor" aria-hidden="true" />
        </p>
        <div>
          {terminal.lines.map((line, index) => (
            <div
              key={`${line.label}-${index}`}
              className={`terminal-line tone-${line.tone}`}
            >
              <span className="terminal-label">{line.label}</span>
              <span className="terminal-value">{line.value}</span>
            </div>
          ))}
        </div>
        <p className="terminal-note">{terminal.note}</p>
      </div>
    </figure>
  );
}