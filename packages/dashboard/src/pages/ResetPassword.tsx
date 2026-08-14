import { useState } from "react"
import { usePageTitle } from "@/lib/usePageTitle"
import { Link, useSearchParams } from "react-router-dom"
import { resetPassword } from "@/lib/auth-client"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import AuthLayout from "@/components/AuthLayout"
import { Loader2, Lock, CheckCircle, ArrowLeft } from "lucide-react"

export default function ResetPasswordPage() {
  usePageTitle("Reset Password")
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await resetPassword({ newPassword: password, token })
      if ((result as { error?: { message?: string } }).error) {
        setError((result as { error: { message?: string } }).error.message ?? "Failed to reset password")
      } else {
        setDone(true)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Invalid link" subtitle="This reset link is missing the required token.">
        <Button variant="outline" className="w-full" asChild>
          <Link to="/login"><ArrowLeft className="mr-1 h-4 w-4" /> Back to login</Link>
        </Button>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout title="Password changed" subtitle="Your password has been updated successfully.">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Password changed successfully.
          </div>
          <Button className="w-full" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Set new password" subtitle="Enter your new password below.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required autoComplete="new-password" minLength={8} className="pl-8" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Reset password
        </Button>
        <p className="mt-1 text-center text-[13px] text-muted-foreground">
          <Link to="/login" className="font-semibold text-primary no-underline hover:underline">Back to login</Link>
        </p>
      </form>
    </AuthLayout>
  )
}