import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { X, Loader2 } from "lucide-react"
import GroupCombobox from "@/components/GroupCombobox"
import { api, type StatusPageRecord, type MonitorWithStatus } from "@/lib/api"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: {
    slug: string
    title: string
    description?: string | null
    showResponseTimes: boolean
    public: boolean
    monitors: { id: string; groupName?: string }[]
  }) => Promise<void>
  initial?: StatusPageRecord | null
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export default function StatusPageDialog({ open, onOpenChange, onSubmit, initial }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "")
  const [slug, setSlug] = useState(initial?.slug ?? "")
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState(initial?.description ?? "")
  const [showResponseTimes, setShowResponseTimes] = useState(initial?.showResponseTimes ?? true)
  const [public_, setPublic_] = useState(initial?.public ?? true)
  const [monitors, setMonitors] = useState<{ id: string; groupName: string }[]>([])
  const [allMonitors, setAllMonitors] = useState<MonitorWithStatus[]>([])
  const [loadingMonitors, setLoadingMonitors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "")
      setSlug(initial?.slug ?? "")
      setSlugEdited(false)
      setDescription(initial?.description ?? "")
      setShowResponseTimes(initial?.showResponseTimes ?? true)
      setPublic_(initial?.public ?? true)
      setError(null)
      setSaving(false)
      setLoadingMonitors(true)

      // Load monitors and pre-select if editing
      api.getAllMonitors().then((res) => {
        setAllMonitors(res.monitors)
        if (initial) {
          api.getStatusPage(initial.id).then((pageRes) => {
            setMonitors(pageRes.monitors.map((m) => ({ id: m.id, groupName: m.groupName })))
          }).catch(() => {})
        }
        setLoadingMonitors(false)
      }).catch(() => {
        setLoadingMonitors(false)
      })
    }
  }, [open, initial])

  function handleTitleChange(value: string) {
    setTitle(value)
    if (!slugEdited) {
      setSlug(slugify(value))
    }
  }

  function toggleMonitor(m: MonitorWithStatus) {
    setMonitors((prev) =>
      prev.some((s) => s.id === m.id)
        ? prev.filter((s) => s.id !== m.id)
        : [...prev, { id: m.id, groupName: m.group ?? "" }]
    )
  }

  function setGroupName(id: string, groupName: string) {
    setMonitors((prev) => prev.map((m) => (m.id === id ? { ...m, groupName } : m)))
  }

  const groupOptions = [...new Set(allMonitors.map((m) => m.group?.trim() ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug) {
      setError("Slug is required")
      return
    }
    if (!slug.match(/^[a-z0-9-]+$/i)) {
      setError("Slug may only contain letters, numbers and dashes")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        slug,
        title,
        description: description || null,
        showResponseTimes,
        public: public_,
        monitors
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
              {initial ? "Edit Status Page" : "Create Status Page"}
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
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="My Status Page"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => { setSlug(e.target.value); setSlugEdited(true) }}
                  placeholder="my-status-page"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Public URL: /status/{slug || "my-status-page"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Current status of all services..."
                  rows={2}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={showResponseTimes} onCheckedChange={setShowResponseTimes} />
                <Label>Show response times</Label>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={public_} onCheckedChange={setPublic_} />
                <Label>Public (accessible without login)</Label>
              </div>

              <div className="space-y-2">
                <Label className="block">Monitors to display</Label>
                <p className="text-xs text-muted-foreground">
                  Select which monitors will appear on the status page.
                </p>
                {loadingMonitors ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : allMonitors.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No monitors found. Create monitors first.
                  </p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                    {allMonitors.map((m) => {
                      const selected = monitors.find((s) => s.id === m.id)
                      const isChecked = !!selected
                      return (
                        <div key={m.id} className="rounded px-1 py-1 hover:bg-muted/40">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 rounded border-gray-300"
                              checked={isChecked}
                              onChange={() => toggleMonitor(m)}
                            />
                            <span className="flex shrink-0 items-center gap-1.5 text-sm">
                              <span
                                className={`inline-block h-2 w-2 rounded-full ${
                                  m.currentStatus === "up" ? "bg-emerald-500" :
                                  m.currentStatus === "down" ? "bg-red-500" :
                                  "bg-muted-foreground/30"
                                }`}
                              />
                              {m.name}
                            </span>
                            <span className="ml-auto truncate text-xs text-muted-foreground max-w-[160px]">
                              {m.url}
                            </span>
                          </label>
                          {isChecked && (
                            <GroupCombobox
                              value={selected?.groupName ?? ""}
                              onChange={(v) => setGroupName(m.id, v)}
                              options={groupOptions}
                              placeholder="Group (optional)"
                              compact
                              className="mt-1"
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t px-4 py-4 md:px-6">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={saving || loadingMonitors}>
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