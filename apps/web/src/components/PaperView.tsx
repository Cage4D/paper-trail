import Markdown from 'react-markdown';

/**
 * A paper copy rendered from its Markdown. "# Title" → h4, "## Section" → h5, "Qn:" → bold "Qn.",
 * "- [ ] option" → ☐ option. Copies carry no answer marks and none are ever shown.
 */
export function PaperView({ markdown, label }: { markdown: string; label: string }) {
  // Turn "Q3: stem" into "**Q3.** stem"; strip task-list boxes (and any answer mark) from options.
  const md = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^Q(\d+):\s*/gm, (_m, n) => `**Q${n}.** `)
    .replace(/^- \[[ xX]\]\s+/gm, '- ');
  return (
    <div className="pt-paper" tabIndex={0} role="region" aria-label={label}>
      <Markdown
        skipHtml
        components={{
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h5>{children}</h5>,
          h3: ({ children }) => <h5>{children}</h5>,
          a: ({ children }) => <span>{children}</span>,
          img: () => null,
        }}
      >
        {md}
      </Markdown>
    </div>
  );
}
