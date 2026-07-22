import { Link, NavLink, Outlet, useLocation } from "react-router-dom"
import { useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Activity,
  Globe,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  Users,
  Webhook
} from "lucide-react"

interface LayoutProps {
  onSignOut: () => void
}

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/crawls", label: "Crawls", icon: ListChecks },
  { to: "/urls/history", label: "URL History", icon: History }
]

const adminNav = [
  { to: "/users", label: "Users", icon: Users },
  { to: "/notifications", label: "Notifications", icon: Webhook },
  { to: "/settings", label: "Settings", icon: Settings }
]

export default function Layout({ onSignOut }: LayoutProps) {
  const { data } = useSession()
  const role = (data?.user as { role?: string } | undefined)?.role
  const location = useLocation()

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Activity className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">supacrawl</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
          {role === "admin" && (
            <>
              <div className="px-3 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Admin
              </div>
              {adminNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 flex items-center gap-2 px-2 text-sm">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="truncate font-medium">{data?.user?.email}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={onSignOut}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <header className="flex h-14 items-center justify-between border-b bg-card px-6 md:hidden">
          <Link to="/" className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            <span className="font-semibold">supacrawl</span>
          </Link>
          <span className="text-xs text-muted-foreground">{data?.user?.email}</span>
        </header>
        <div className="p-6" key={location.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
