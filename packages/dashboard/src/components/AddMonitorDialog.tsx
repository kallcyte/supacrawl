import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { X, Loader2 } from "lucide-react"
import GroupCombobox from "@/components/GroupCombobox"
import type { Monitor } from "@/lib/api"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: Partial<Monitor>) => Promise<void>
  initial?: Monitor | null
  existingGroups?: string[]
}

export default function AddMonitorDialog({ open, onOpenChange, onSubmit, initial, existingGroups = [] }: Props) {
  const [name, setName] = useState(initial?.name ?? "")
  const [url, setUrl] = useState(initial?.url ?? "")
  const [group, setGroup] = useState(initial?.group ?? "")
  const [method, setMethod] = useState(initial?.method ?? "GET")
  const [expectedStatus, setExpectedStatus] = useState(String(initial?.expectedStatus ?? 200))
  const [expectedBody, setExpectedBody] = useState(initial?.expectedBody ?? "")
  const [intervalSeconds, setIntervalSeconds] = useState(String(initial?.intervalSeconds ?? 60))
  const [retryCount, setRetryCount] = useState(String(initial?.retryCount ?? 3))
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.timeoutMs ?? 10000))
  const [acceptedResponseTimeMs, setAcceptedResponseTimeMs] = useState(
    String(initial?.acceptedResponseTimeMs ?? 5000)
  )
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {      setName(initial?.name ?? "")
      setUrl(initial?.url ?? "")
      setGroup(initial?.group ?? "")
      setMethod(initial?.method ?? "GET")
      setExpectedStatus(String(initial?.expectedStatus ?? 200))
      setExpectedBody(initial?.expectedBody ?? "")
      setIntervalSeconds(String(initial?.intervalSeconds ?? 60))
      setRetryCount(String(initial?.retryCount ?? 3))
      setTimeoutMs(String(initial?.timeoutMs ?? 10000))
      setAcceptedResponseTimeMs(String(initial?.acceptedResponseTimeMs ?? 5000))
      setEnabled(initial?.enabled ?? true)
      setError(null)
      setSaving(false)
    }
  }, [open, initial])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        name,
        url,
        type: "http",
        group,
        method,
        expectedStatus: Number(expectedStatus) || 200,
        expectedBody: expectedBody.trim() ? expectedBody.trim() : null,
        intervalSeconds: Number(intervalSeconds) || 60,
        retryCount: Number(retryCount) || 0,
        timeoutMs: Number(timeoutMs) || 10000,
        acceptedResponseTimeMs: Number(acceptedResponseTimeMs) || 5000,
        enabled
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
              {initial ? "Edit Monitor" : "Add Monitor"}
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
                <Input id="name" value={name} placeholder="My API endpoint" onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">Target URL</Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  placeholder="https://example.com/api/health"
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Monitored every {intervalSeconds || 60}s. Checks for HTTP {expectedStatus || 200}.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="group">Group (optional)</Label>
                <GroupCombobox
                  value={group}
                  onChange={setGroup}
                  options={existingGroups}
                  placeholder="e.g. API, Web, Database"
                />
                <p className="text-xs text-muted-foreground">
                  Monitors are grouped under this label on the Monitors page and status pages.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="method">Method</Label>
                  <select
                    id="method"
                    className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                    <option value="POST">POST</option>
                    <option value="OPTIONS">OPTIONS</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedStatus">Expected status</Label>
                  <Input
                    id="expectedStatus"
                    type="number"
                    min={100}
                    max={599}
                    value={expectedStatus}
                    onChange={(e) => setExpectedStatus(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expectedBody">Expected body keyword (optional)</Label>
                <Input
                  id="expectedBody"
                  value={expectedBody}
                  placeholder='e.g. {"status":"ok"}'
                  onChange={(e) => setExpectedBody(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  If set, the monitor only counts as up when the response contains this text.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="intervalSeconds">Interval (seconds)</Label>
                  <Input
                    id="intervalSeconds"
                    type="number"
                    min={10}
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="retryCount">Retries per check</Label>
                  <Input
                    id="retryCount"
                    type="number"
                    min={0}
                    value={retryCount}
                    onChange={(e) => setRetryCount(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="timeoutMs">Timeout (ms)</Label>
                  <Input
                    id="timeoutMs"
                    type="number"
                    min={1000}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="acceptedResponseTimeMs">Alert above (ms)</Label>
                  <Input
                    id="acceptedResponseTimeMs"
                    type="number"
                    min={100}
                    value={acceptedResponseTimeMs}
                    onChange={(e) => setAcceptedResponseTimeMs(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label>Monitoring enabled</Label>
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
