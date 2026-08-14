import { useState } from "react"
import { usePageTitle } from "@/lib/usePageTitle"
import { Link } from "react-router-dom"
import { forgetPassword } from "@/lib/auth-client"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import AuthLayout from "@/components/AuthLayout"
import { Loader2, Mail, CheckCircle, ArrowLeft } from "lucide-react"

export default function ForgotPasswordPage() {
  usePageTitle("Forgot Password")
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await forgetPassword({ email })
      if ((result as { error?: { message?: string } }).error) {
        setError((result as { error: { message?: string } }).error.message ?? "Failed to send reset email")
      } else {
        setSent(true)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email" subtitle="We've sent a password reset link if the account exists.">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Reset link sent. Check your email (or server logs if no SMTP is configured).
          </div>
          <Button variant="outline" className="w-full" asChild>
            <Link to="/login"><ArrowLeft className="mr-1 h-4 w-4" /> Back to login</Link>
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send you a reset link.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" className="pl-8" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Send reset link
        </Button>
        <p className="mt-1 text-center text-[13px] text-muted-foreground">
          <Link to="/login" className="font-semibold text-primary no-underline hover:underline">Back to login</Link>
        </p>
      </form>
    </AuthLayout>
  )
}