import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { X, Loader2, Search } from "lucide-react"
import { api, type CrawlJob, type SitemapTreeNode } from "@/lib/api"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: Partial<CrawlJob>) => Promise<void>
  initial?: CrawlJob | null
}

const SCHEDULE_PRESETS: { label: string; value: number; unit: "minutes" | "hours" | "days" }[] = [
  { label: "Every 15 minutes", value: 15, unit: "minutes" },
  { label: "Every 30 minutes", value: 30, unit: "minutes" },
  { label: "Every hour", value: 1, unit: "hours" },
  { label: "Every 2 hours", value: 2, unit: "hours" },
  { label: "Every 6 hours", value: 6, unit: "hours" },
  { label: "Every 12 hours", value: 12, unit: "hours" },
  { label: "Every day", value: 1, unit: "days" },
  { label: "Every 2 days", value: 2, unit: "days" },
  { label: "Every week", value: 7, unit: "days" }
]

export default function AddCrawlJobDialog({ open, onOpenChange, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? "")
  const [sitemapUrl, setSitemapUrl] = useState(initial?.sitemapUrl ?? "")
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [intervalValue, setIntervalValue] = useState(String(initial?.intervalValue ?? 60))
  const [intervalUnit, setIntervalUnit] = useState<"minutes" | "hours" | "days">(
    initial?.intervalUnit ?? "minutes"
  )
  const [runAt, setRunAt] = useState(initial?.runAt ?? "")
  const [notifyOnComplete, setNotifyOnComplete] = useState(initial?.notifyOnComplete ?? false)
  const [notifyOnFailure, setNotifyOnFailure] = useState(initial?.notifyOnFailure ?? true)
  const [notifyOnChange, setNotifyOnChange] = useState(initial?.notifyOnChange ?? true)
  const [detectMojibake, setDetectMojibake] = useState(initial?.detectMojibake ?? true)
  const [notifyOnMojibake, setNotifyOnMojibake] = useState(initial?.notifyOnMojibake ?? false)
  const [maxUrls, setMaxUrls] = useState(String(initial?.maxUrls ?? 999999))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [tree, setTree] = useState<SitemapTreeNode | null>(null)
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set(initial?.sitemapUrls ?? []))

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "")
      setSitemapUrl(initial?.sitemapUrl ?? "")
      setEnabled(initial?.enabled ?? true)
      setIntervalValue(String(initial?.intervalValue ?? 60))
      setIntervalUnit(initial?.intervalUnit ?? "minutes")
      setRunAt(initial?.runAt ?? "")
      setNotifyOnComplete(initial?.notifyOnComplete ?? false)
      setNotifyOnFailure(initial?.notifyOnFailure ?? true)
      setNotifyOnChange(initial?.notifyOnChange ?? true)
      setDetectMojibake(initial?.detectMojibake ?? true)
      setNotifyOnMojibake(initial?.notifyOnMojibake ?? false)
      setError(null)
      setTree(null)
      setSelectedUrls(new Set(initial?.sitemapUrls ?? []))
      setMaxUrls(String(initial?.maxUrls ?? 999999))
      setSaving(false)
      setDiscovering(false)
    }
  }, [open, initial])

  useEffect(() => {
    if (!open || !initial?.sitemapUrl) return
    ;(async () => {
      setDiscovering(true)
      try {
        const t = await api.discoverSitemapTree(initial.sitemapUrl)
        setTree(t)
        if (t.children.length > 0 && initial.sitemapUrls) {
          setSelectedUrls(new Set(initial.sitemapUrls))
        }
      } catch {
        // silent — tree stays null, user can click Discover
      } finally {
        setDiscovering(false)
      }
    })()
  }, [open, initial?.sitemapUrl])

  async function handleDiscover() {
    if (!sitemapUrl) return
    setDiscovering(true)
    setError(null)
    try {
      const t = await api.discoverSitemapTree(sitemapUrl)
      setTree(t)
      if (t.children.length === 0) {
        setSelectedUrls(new Set())
      } else if (initial?.sitemapUrls) {
        setSelectedUrls(new Set(initial.sitemapUrls))
      } else {
        setSelectedUrls(new Set(t.children.map((c) => c.url)))
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDiscovering(false)
    }
  }

  function toggleChild(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  function renderTree(node: SitemapTreeNode, depth = 0) {
    if (node.children.length === 0) return null
    return (
      <div style={{ marginLeft: depth * 16 }}>
        {node.children.map((child) => {
          const isLeaf = child.children.length === 0
          return (
            <div key={child.url}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={selectedUrls.has(child.url)}
                  onChange={() => toggleChild(child.url)}
                />
                <span className="truncate text-sm">{child.url}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  ({child.leafCount})
                </span>
              </label>
              {!isLeaf && renderTree(child, depth + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const sitemapUrls = tree && tree.children.length > 0 ? [...selectedUrls] : null
      await onSubmit({
        name,
        sitemapUrl,
        sitemapUrls: sitemapUrls && sitemapUrls.length > 0 ? sitemapUrls : null,
        enabled,
        intervalValue: Number(intervalValue),
        intervalUnit,
        runAt: runAt || null,
        notifyOnComplete,
        notifyOnFailure,
        notifyOnChange,
        detectMojibake,
        notifyOnMojibake,
        delayMs: initial?.delayMs ?? 2000,
        maxConcurrency: initial?.maxConcurrency ?? 2,
        timeoutMs: initial?.timeoutMs ?? 30000,
        userAgent: initial?.userAgent ?? "supacrawl/0.1",
        respectRobotsTxt: initial?.respectRobotsTxt ?? true,
        maxUrls: Number(maxUrls) || 999999
      })
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-4 md:px-6">
            <Dialog.Title className="text-lg font-semibold">
              {initial ? "Edit Crawl Job" : "Add Crawl Job"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6">
              {error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sitemapUrl">URL (site or sitemap)</Label>
                <div className="flex gap-2">
                  <Input
                    id="sitemapUrl"
                    type="url"
                    value={sitemapUrl}
                    placeholder="https://example.com or https://example.com/sitemap.xml"
                    onChange={(e) => { setSitemapUrl(e.target.value); setTree(null) }}
                    required
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" onClick={handleDiscover} disabled={!sitemapUrl || discovering}>
                    {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Discover
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter your site URL and Supacrawl will auto-detect sitemaps from robots.txt and common locations.
                </p>
              </div>

              {tree && tree.children.length > 0 && (
                <div className="space-y-1 rounded-md border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Discovered sitemaps ({selectedUrls.size} / {tree.children.length} selected)
                  </p>
                  <div className="max-h-48 space-y-1 overflow-auto">
                    {renderTree(tree)}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="maxUrls">Max URLs per crawl</Label>
                <Input
                  id="maxUrls"
                  type="number"
                  min={1}
                  value={maxUrls}
                  onChange={(e) => setMaxUrls(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Total URLs from all selected sitemaps are deduplicated. Increase if your sitemaps contain more URLs.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label>Enabled</Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schedulePreset">Schedule</Label>
                <select
                  id="schedulePreset"
                  className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={SCHEDULE_PRESETS.some(
                    (p) => p.value === Number(intervalValue) && p.unit === intervalUnit
                  )
                    ? SCHEDULE_PRESETS.find(
                        (p) => p.value === Number(intervalValue) && p.unit === intervalUnit
                      )!.label
                    : "custom"}
                  onChange={(e) => {
                    const label = e.target.value
                    const preset = SCHEDULE_PRESETS.find((p) => p.label === label)
                    if (preset) {
                      setIntervalValue(String(preset.value))
                      setIntervalUnit(preset.unit)
                      if (preset.unit !== "days") setRunAt("")
                    }
                  }}
                >
                  {SCHEDULE_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>

                {!SCHEDULE_PRESETS.some(
                  (p) => p.value === Number(intervalValue) && p.unit === intervalUnit
                ) && (
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="intervalValue">Check interval</Label>
                      <Input
                        id="intervalValue"
                        type="number"
                        min={1}
                        value={intervalValue}
                        onChange={(e) => setIntervalValue(e.target.value)}
                      />
                    </div>
                    <select
                      className="h-10 rounded-md border bg-background px-3 py-2 text-sm"
                      value={intervalUnit}
                      onChange={(e) => setIntervalUnit(e.target.value as typeof intervalUnit)}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                )}

                {SCHEDULE_PRESETS.some(
                  (p) => p.value === Number(intervalValue) && p.unit === intervalUnit
                ) && (intervalUnit === "days" || runAt !== "") && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="runAt" className="text-sm text-muted-foreground">
                      at
                    </Label>
                    <Input
                      id="runAt"
                      type="time"
                      value={runAt}
                      onChange={(e) => setRunAt(e.target.value)}
                      className="w-32"
                      aria-label="Time of day"
                    />
                    <span className="text-xs text-muted-foreground">(optional)</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="block">Notifications</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={notifyOnFailure} onCheckedChange={setNotifyOnFailure} />
                  <span className="text-sm">On failure</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={notifyOnChange} onCheckedChange={setNotifyOnChange} />
                  <span className="text-sm">On content change</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={notifyOnComplete} onCheckedChange={setNotifyOnComplete} />
                  <span className="text-sm">On complete</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="block">Mojibake Detection</Label>
                <div className="flex items-center gap-2">
                  <Switch checked={detectMojibake} onCheckedChange={setDetectMojibake} />
                  <span className="text-sm">Detect garbled text (mojibake)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={notifyOnMojibake} onCheckedChange={setNotifyOnMojibake} disabled={!detectMojibake} />
                  <span className="text-sm">Notify on mojibake detected</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t px-4 py-4 md:px-6">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {initial ? "Save" : "Create"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
