import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  value: string
  onChange: (value: string) => void
  options: string[]
  placeholder?: string
  className?: string
  compact?: boolean
}

export default function GroupCombobox({ value, onChange, options, placeholder, className, compact }: Props) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, value])

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!open) setHighlighted(0)
  }, [open, value])

  function select(option: string) {
    onChange(option)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === "Enter") {
      if (filtered[highlighted]) {
        e.preventDefault()
        select(filtered[highlighted]!)
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("pr-8", compact && "h-7 pl-6 text-xs")}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 flex h-full w-8 items-center justify-center text-muted-foreground hover:text-foreground"
        title="Show groups"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-background shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {options.length === 0 ? "No groups yet" : "Add new group"}
            </p>
          ) : (
            filtered.map((option, i) => (
              <button
                key={option}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(option)
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-sm hover:bg-accent",
                  i === highlighted && "bg-accent"
                )}
              >
                {option}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}