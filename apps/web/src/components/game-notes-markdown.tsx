import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
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
        "rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm font-mono text-orange-200",
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
                "mt-5 mb-2 text-base font-semibold uppercase tracking-[0.18em] text-orange-100 first:mt-0",
                headingClassName,
              )}
              {...props}
            />
          ),
          h2: ({ className: headingClassName, ...props }) => (
            <h2
              className={cn(
                "mt-5 mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-orange-100 first:mt-0",
                headingClassName,
              )}
              {...props}
            />
          ),
          h3: ({ className: headingClassName, ...props }) => (
            <h3
              className={cn(
                "mt-4 mb-2 text-sm font-semibold text-orange-100 first:mt-0",
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
                "my-3 list-disc space-y-2 pl-6 marker:text-orange-300",
                listClassName,
              )}
              {...props}
            />
          ),
          ol: ({ className: listClassName, ...props }) => (
            <ol
              className={cn(
                "my-3 list-decimal space-y-2 pl-6 marker:text-orange-300",
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
                  "text-orange-100 underline decoration-orange-300/60 underline-offset-4 transition-colors hover:text-orange-50",
                  linkClassName,
                )}
              />
            );
          },
          blockquote: ({ className: quoteClassName, ...props }) => (
            <blockquote
              className={cn(
                "my-3 border-l-2 border-orange-300/40 pl-4 text-orange-200/85 italic",
                quoteClassName,
              )}
              {...props}
            />
          ),
          hr: ({ className: ruleClassName, ...props }) => (
            <hr
              className={cn("my-4 border-orange-400/20", ruleClassName)}
              {...props}
            />
          ),
          table: ({ className: tableClassName, ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table
                className={cn(
                  "min-w-full border-collapse border border-orange-400/20 text-left",
                  tableClassName,
                )}
                {...props}
              />
            </div>
          ),
          thead: ({ className: headClassName, ...props }) => (
            <thead
              className={cn("bg-orange-400/10", headClassName)}
              {...props}
            />
          ),
          th: ({ className: cellClassName, ...props }) => (
            <th
              className={cn(
                "border border-orange-400/20 px-3 py-2 font-semibold text-orange-100",
                cellClassName,
              )}
              {...props}
            />
          ),
          td: ({ className: cellClassName, ...props }) => (
            <td
              className={cn(
                "border border-orange-400/20 px-3 py-2 align-top text-orange-200/90",
                cellClassName,
              )}
              {...props}
            />
          ),
          pre: ({ className: preClassName, ...props }) => (
            <pre
              className={cn(
                "my-4 overflow-x-auto rounded-md border border-orange-400/20 bg-black/70 px-3 py-3 text-orange-100",
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
                  className={cn("text-orange-100", codeClassName)}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                className={cn(
                  "rounded bg-black/60 px-1.5 py-0.5 text-orange-100",
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
