import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fieldLabel } from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

type GameNotesMarkdownProps = {
  content: string;
  className?: string;
};

const unorderedListPattern = /^\s*[-*+]\s+/;
const orderedListPattern = /^\s*\d+\.\s+/;

function isListLine(line: string) {
  return unorderedListPattern.test(line) || orderedListPattern.test(line);
}

function normalizeMarkdownLists(content: string) {
  const lines = content.split(/\r?\n/);
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const previousLine = normalizedLines.at(-1) ?? "";
    const previousLineIsBlank = previousLine.trim().length === 0;

    if (isListLine(line) && !previousLineIsBlank && !isListLine(previousLine)) {
      normalizedLines.push("");
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join("\n");
}

export function GameNotesMarkdown({
  content,
  className,
}: GameNotesMarkdownProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-terminal-400/20 bg-terminal-400/5 px-4 py-4 text-sm font-mono text-terminal-300",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={defaultUrlTransform}
        components={{
          h1: ({ className: headingClassName, ...props }) => (
            <h1
              className={cn(
                "mt-5 mb-2 text-base font-bold uppercase tracking-[0.16em] text-terminal-200 first:mt-0",
                headingClassName,
              )}
              {...props}
            />
          ),
          h2: ({ className: headingClassName, ...props }) => (
            <h2
              className={cn(
                "mt-5 mb-2 text-sm font-bold uppercase tracking-[0.16em] text-terminal-200 first:mt-0",
                headingClassName,
              )}
              {...props}
            />
          ),
          h3: ({ className: headingClassName, ...props }) => (
            <h3
              className={cn(
                "mt-4 mb-2 text-sm font-medium text-terminal-200 first:mt-0",
                headingClassName,
              )}
              {...props}
            />
          ),
          p: ({ className: paragraphClassName, ...props }) => (
            <p
              className={cn(
                "my-3 whitespace-pre-wrap break-words leading-6 first:mt-0 last:mb-0",
                paragraphClassName,
              )}
              {...props}
            />
          ),
          ul: ({ className: listClassName, ...props }) => (
            <ul
              className={cn(
                "my-3 list-disc space-y-2 pl-6 marker:text-terminal-300/70",
                listClassName,
              )}
              {...props}
            />
          ),
          ol: ({ className: listClassName, ...props }) => (
            <ol
              className={cn(
                "my-3 list-decimal space-y-2 pl-6 marker:text-terminal-300/70",
                listClassName,
              )}
              {...props}
            />
          ),
          li: ({ className: itemClassName, ...props }) => (
            <li className={cn("pl-1", itemClassName)} {...props} />
          ),
          a: ({ className: linkClassName, href, ...props }) => {
            if (!href) {
              return <span {...props} />;
            }

            return (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "text-terminal-200 underline decoration-terminal-300/70 underline-offset-4 transition-colors hover:decoration-terminal-200",
                  linkClassName,
                )}
              />
            );
          },
          blockquote: ({ className: quoteClassName, ...props }) => (
            <blockquote
              className={cn(
                "my-3 border-l-2 border-terminal-400/30 pl-4 text-terminal-300/70 italic",
                quoteClassName,
              )}
              {...props}
            />
          ),
          hr: ({ className: ruleClassName, ...props }) => (
            <hr
              className={cn("my-4 border-terminal-400/20", ruleClassName)}
              {...props}
            />
          ),
          table: ({ className: tableClassName, ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table
                className={cn(
                  "min-w-full border-collapse text-left",
                  tableClassName,
                )}
                {...props}
              />
            </div>
          ),
          thead: ({ className: headClassName, ...props }) => (
            <thead
              className={cn("bg-terminal-400/10", headClassName)}
              {...props}
            />
          ),
          th: ({ className: cellClassName, ...props }) => (
            <th
              className={cn(
                "border-b border-terminal-400/20 px-3 py-2 font-normal",
                fieldLabel,
                cellClassName,
              )}
              {...props}
            />
          ),
          td: ({ className: cellClassName, ...props }) => (
            <td
              className={cn(
                "border-b border-terminal-400/20 px-3 py-2 align-top text-terminal-300",
                cellClassName,
              )}
              {...props}
            />
          ),
          pre: ({ className: preClassName, ...props }) => (
            <pre
              className={cn(
                "my-4 overflow-x-auto rounded-md border border-terminal-400/20 bg-terminal-400/10 px-3 py-3 text-terminal-200",
                preClassName,
              )}
              {...props}
            />
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const isBlock = codeClassName?.includes("language-");

            if (isBlock) {
              return (
                <code
                  className={cn("text-terminal-200", codeClassName)}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                className={cn(
                  "rounded bg-terminal-400/10 px-1.5 py-0.5 text-terminal-200",
                  codeClassName,
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          img: () => null,
        }}
      >
        {normalizeMarkdownLists(content)}
      </ReactMarkdown>
    </div>
  );
}
