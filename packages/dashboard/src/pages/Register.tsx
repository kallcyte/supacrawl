import { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { api, ApiError } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import AuthLayout from "@/components/AuthLayout"
import { Loader2, Mail, Lock, User } from "lucide-react"

export default function RegisterPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [closed, setClosed] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.setupStatus().then((s) => {
      if (!s.allowRegistration) setClosed(true)
      setChecking(false)
    }).catch(() => setChecking(false))
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.registerUser({ email, password, name: name || undefined })
      navigate("/login")
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | undefined
        setError(body?.error ?? `API error ${err.status}`)
      } else {
        setError((err as { message?: string }).message ?? "Registration failed")
      }
    } finally {
      setLoading(false)
    }
  }

  if (closed) {
    return (
      <AuthLayout title="Registration closed" subtitle="Account registration is currently disabled." checking={false}>
        <Button className="w-full" variant="outline" asChild>
          <Link to="/login">Back to sign in</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Create account" subtitle="Sign up to start monitoring your sites." checking={checking}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" className="pl-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className="pl-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8} autoComplete="new-password" className="pl-8" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Create account
        </Button>
        <p className="mt-1 text-center text-[13px] text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary no-underline hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  )
}