import { useState, useEffect } from "react"
import { useNavigate, useLocation, Link } from "react-router-dom"
import { signIn } from "@/lib/auth-client"
import { api } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Activity, Loader2 } from "lucide-react"

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
      } else {
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle>supacrawl</CardTitle>
          </div>
          <CardDescription>Sign in to access the dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">Forgot password?</Link>
            </p>
          </form>
          {registrationOpen && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              No account?{" "}
              <Link to="/register" className="text-primary underline-offset-4 hover:underline">
                Create one
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
