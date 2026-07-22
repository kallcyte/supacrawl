import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { useSession, signOut } from "@/lib/auth-client"
import LoginPage from "@/pages/Login"
import SetupPage from "@/pages/Setup"
import RegisterPage from "@/pages/Register"
import OverviewPage from "@/pages/Overview"
import CrawlsPage from "@/pages/Crawls"
import CrawlDetailPage from "@/pages/CrawlDetail"
import UrlHistoryPage from "@/pages/UrlHistory"
import UsersPage from "@/pages/Users"
import NotificationsPage from "@/pages/Notifications"
import SettingsPage from "@/pages/Settings"
import Layout from "@/components/Layout"
import { Loader2 } from "lucide-react"

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession()
  const location = useLocation()
  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (!data) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { data } = useSession()
  const role = (data?.user as { role?: string } | undefined)?.role
  if (role !== "admin") {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<RequireAuth><Layout onSignOut={() => signOut()} /></RequireAuth>}>
        <Route index element={<OverviewPage />} />
        <Route path="crawls" element={<CrawlsPage />} />
        <Route path="crawls/:id" element={<CrawlDetailPage />} />
        <Route path="urls/history" element={<UrlHistoryPage />} />
        <Route path="users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="notifications" element={<RequireAdmin><NotificationsPage /></RequireAdmin>} />
        <Route path="settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
