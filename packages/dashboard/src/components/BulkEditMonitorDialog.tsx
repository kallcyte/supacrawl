import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import type { Monitor } from "@/lib/api"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (patch: Partial<Monitor>) => Promise<void>
}

const NO_CHANGE = "__NO_CHANGE__"

export default function BulkEditMonitorDialog({ open, onOpenChange, onSubmit }: Props) {
  const [method, setMethod] = useState(NO_CHANGE)
  const [enabled, setEnabled] = useState(NO_CHANGE)
  const [expectedStatus, setExpectedStatus] = useState("")
  const [intervalSeconds, setIntervalSeconds] = useState("")
  const [timeoutMs, setTimeoutMs] = useState("")
  const [acceptedResponseTimeMs, setAcceptedResponseTimeMs] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMethod(NO_CHANGE)
      setEnabled(NO_CHANGE)
      setExpectedStatus("")
      setIntervalSeconds("")
      setTimeoutMs("")
      setAcceptedResponseTimeMs("")
      setError(null)
      setSaving(false)
    }
  }, [open])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const patch: Partial<Monitor> = {}
    if (method !== NO_CHANGE) patch.method = method
    if (enabled !== NO_CHANGE) patch.enabled = enabled === "true"
    if (expectedStatus.trim()) patch.expectedStatus = Number(expectedStatus)
    if (intervalSeconds.trim()) patch.intervalSeconds = Number(intervalSeconds)
    if (timeoutMs.trim()) patch.timeoutMs = Number(timeoutMs)
    if (acceptedResponseTimeMs.trim()) patch.acceptedResponseTimeMs = Number(acceptedResponseTimeMs)
    if (Object.keys(patch).length === 0) {
      setError("Select at least one field to update.")
      return
    }
    setSaving(true)
    setError(null)
    onSubmit(patch)
      .then(() => onOpenChange(false))
      .catch((err) => setError((err as Error).message))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit selected monitors</DialogTitle>
          <DialogDescription>
            Fields you fill in are applied to every selected monitor. Leave a field blank to keep
            its current value.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-method">Method</Label>
              <select
                id="bulk-method"
                className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value={NO_CHANGE}>No change</option>
                <option value="GET">GET</option>
                <option value="HEAD">HEAD</option>
                <option value="POST">POST</option>
                <option value="OPTIONS">OPTIONS</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-enabled">Status</Label>
              <select
                id="bulk-enabled"
                className="h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={enabled}
                onChange={(e) => setEnabled(e.target.value)}
              >
                <option value={NO_CHANGE}>No change</option>
                <option value="true">Enable</option>
                <option value="false">Disable</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-status">Expected status</Label>
              <Input
                id="bulk-status"
                type="number"
                min={100}
                max={599}
                placeholder="No change"
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-interval">Interval (seconds)</Label>
              <Input
                id="bulk-interval"
                type="number"
                min={10}
                placeholder="No change"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-timeout">Timeout (ms)</Label>
              <Input
                id="bulk-timeout"
                type="number"
                min={1000}
                placeholder="No change"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-response-time">Alert above (ms)</Label>
              <Input
                id="bulk-response-time"
                type="number"
                min={100}
                placeholder="No change"
                value={acceptedResponseTimeMs}
                onChange={(e) => setAcceptedResponseTimeMs(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
