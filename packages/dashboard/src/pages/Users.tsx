import { useEffect, useState } from "react"
import { api, type User } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { Trash2, UserPlus } from "lucide-react"
import { useSession } from "@/lib/auth-client"

export default function UsersPage() {
  const { data: me } = useSession()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState<"admin" | "user">("user")

  async function load() {
    try {
      const r = await api.listUsers()
      const list = Array.isArray(r) ? r : (r as { users: User[] }).users
      setUsers(list)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.createUser({ email, password, name: name || undefined, role })
      setEmail("")
      setPassword("")
      setName("")
      setRole("user")
      setCreating(false)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this user?")) return
    try {
      await api.deleteUser(id)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function onRoleChange(id: string, newRole: "admin" | "user") {
    try {
      await api.setUserRole(id, newRole)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const myId = (me?.user as { id?: string } | undefined)?.id

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage who can access the dashboard
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <UserPlus className="mr-1 h-3.5 w-3.5" />
          {creating ? "Cancel" : "New user"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>Create user</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Name (optional)</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as "admin" | "user")}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Button type="submit">Create</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
          <CardDescription>{users.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>
                      <select
                        className="rounded border bg-transparent px-2 py-1 text-xs"
                        value={u.role}
                        onChange={(e) =>
                          onRoleChange(u.id, e.target.value as "admin" | "user")
                        }
                        disabled={u.id === myId}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                      {u.id === myId && (
                        <Badge variant="outline" className="ml-2">
                          you
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(u.id)}
                        disabled={u.id === myId}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
