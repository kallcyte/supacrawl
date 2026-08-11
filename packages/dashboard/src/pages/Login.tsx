import { useState, useEffect } from "react"
import { useNavigate, useLocation, Link } from "react-router-dom"
import { signIn } from "@/lib/auth-client"
import { api } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import AuthLayout from "@/components/AuthLayout"
import { Loader2, Mail, Lock } from "lucide-react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/"
  const redirectReason = (location.state as { reason?: string } | null)?.reason

  useEffect(() => {
    api.setupStatus().then((s) => {
      setRegistrationOpen(s.allowRegistration)
      if (!s.hasUsers) {
        navigate("/setup", { replace: true })
        return
      }
      setChecking(false)
    }).catch(() => setChecking(false))
  }, [navigate])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await signIn.email({ email, password })
      if ((result as { error?: { message?: string } }).error) {
        setError((result as { error: { message?: string } }).error.message ?? "Login failed")
        return
      }
      // The session cookie is set by the Set-Cookie header in the signIn
      // response. Navigate immediately — RequireAuth's useSession() will
      // validate on the next render and the browser will attach the cookie
      // to that request. An extra getSession() round-trip here causes a race
      // where the dashboard sometimes fails to detect the session.
      navigate(from, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue monitoring your sites." checking={checking}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" className="pl-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-[13px] text-primary no-underline hover:underline">Reset password</Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required autoComplete="current-password" className="pl-8" />
          </div>
        </div>
        {redirectReason === "session_expired" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Your session could not be established. Please try signing in again.
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Sign in to supacrawl
        </Button>
        {registrationOpen && (
          <p className="mt-1 text-center text-[13px] text-muted-foreground">
            No account?{" "}
            <Link to="/register" className="font-semibold text-primary no-underline hover:underline">Create one</Link>
          </p>
        )}
      </form>
    </AuthLayout>
  )
}