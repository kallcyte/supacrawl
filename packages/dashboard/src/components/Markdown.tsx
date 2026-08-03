import React from "react"

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-${i}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-${i}`} className="rounded bg-muted px-1 py-0.5 text-[13px]">
          {token.slice(1, -1)}
        </code>
      )
    } else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)
      if (link) {
        parts.push(
          <a key={`${keyPrefix}-${i}`} href={link[2]} target="_blank" rel="noreferrer" className="text-primary underline">
            {link[1]}
          </a>
        )
      }
    }
    lastIndex = match.index + token.length
    i++
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export default function Markdown({ content }: { content: string }) {
  const lines = content.split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let codeBlock: string[] | null = null
  let blockKey = 0

  for (const line of lines) {
    if (codeBlock !== null) {
      if (line.trim() === "```") {
        blocks.push(
          <pre key={`code-${blockKey++}`} className="overflow-x-auto rounded-md bg-muted p-3 text-[13px]">
            {codeBlock.join("\n")}
          </pre>
        )
        codeBlock = null
      } else {
        codeBlock.push(line)
      }
      continue
    }
    if (line.trim() === "```") {
      codeBlock = []
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const text = renderInline(heading[2], `h${blockKey}`)
      const cls =
        level === 1
          ? "text-lg font-semibold"
          : level === 2
            ? "text-base font-semibold"
            : level === 3
              ? "text-sm font-semibold"
              : "text-sm font-medium"
      blocks.push(
        <div key={`h-${blockKey++}`} className={cls}>
          {text}
        </div>
      )
      continue
    }

    const listItem = /^\s*[-*]\s+(.*)$/.exec(line)
    if (listItem) {
      blocks.push(
        <div key={`li-${blockKey++}`} className="flex gap-2">
          <span className="text-muted-foreground">•</span>
          <span>{renderInline(listItem[1], `li-${blockKey}`)}</span>
        </div>
      )
      continue
    }

    if (line.trim() === "") {
      continue
    }

    blocks.push(
      <p key={`p-${blockKey++}`} className="text-sm leading-relaxed text-muted-foreground">
        {renderInline(line, `p-${blockKey}`)}
      </p>
    )
  }

  return <div className="space-y-2.5">{blocks}</div>
}
