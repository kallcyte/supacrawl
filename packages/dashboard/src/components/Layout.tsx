import { useEffect, useState } from "react"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"
import { useSession } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import Toaster from "@/components/Toaster"
import {
  Activity,
  Globe,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Sun,
  Users,
  Bell
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
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings }
]

export default function Layout({ onSignOut }: LayoutProps) {
  const { data } = useSession()
  const role = (data?.user as { role?: string } | undefined)?.role
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [dark, setDark] = useState(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("theme")
      if (stored) return stored === "dark"
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    localStorage.setItem("theme", dark ? "dark" : "light")
  }, [dark])

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-card transition-all duration-300 md:static",
          sidebarOpen ? "w-60" : "w-0 -translate-x-full md:w-16 md:translate-x-0"
        )}
      >
        <div className={cn("flex h-14 items-center border-b", sidebarOpen ? "gap-2 px-4" : "justify-center px-2")}>
          {sidebarOpen && (
            <>
              <Activity className="h-5 w-5 shrink-0 text-primary" />
              <span className="text-lg font-semibold">supacrawl</span>
            </>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn(
              "rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              sidebarOpen ? "ml-auto" : ""
            )}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarOpen ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-hidden p-3">
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
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  !sidebarOpen && "justify-center px-2"
                )
              }
              title={!sidebarOpen ? item.label : undefined}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {sidebarOpen && item.label}
            </NavLink>
          ))}
          {role === "admin" && (
            <>
              {sidebarOpen && (
                <div className="px-3 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Admin
                </div>
              )}
              {adminNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      !sidebarOpen && "justify-center px-2"
                    )
                  }
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {sidebarOpen && item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="border-t p-3">
          {sidebarOpen ? (
            <>
              <div className="mb-2 flex items-center gap-2 px-2 text-sm">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{data?.user?.email}</span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setDark(!dark)}
                  title={dark ? "Light mode" : "Dark mode"}
                >
                  {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 justify-start gap-2"
                  onClick={onSignOut}
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Sign out
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setDark(!dark)}
                title={dark ? "Light mode" : "Dark mode"}
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={onSignOut}
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
            title="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/" className="flex items-center gap-2 md:hidden">
            <Activity className="h-5 w-5" />
            <span className="font-semibold">supacrawl</span>
          </Link>
          <span className="ml-auto text-xs text-muted-foreground">{data?.user?.email}</span>
        </header>
        <div className="flex-1 p-6" key={location.pathname}>
          <Outlet />
        </div>
      </main>
      <Toaster />
    </div>
  )
}
