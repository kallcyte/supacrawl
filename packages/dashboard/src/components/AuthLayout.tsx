import { Activity, Loader2 } from "lucide-react"

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: React.ReactNode
  checking?: boolean
}

export default function AuthLayout({ title, subtitle, children, checking }: AuthLayoutProps) {
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between bg-[radial-gradient(900px_600px_at_12%_8%,rgba(255,255,255,0.06),transparent_60%),radial-gradient(700px_500px_at_90%_100%,rgba(99,168,255,0.18),transparent_65%),linear-gradient(180deg,#001C44_0%,#02142e_100%)] px-12 py-14">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 text-white">
            <Activity className="h-7 w-7" />
            <span className="text-xl font-bold">supacrawl</span>
          </div>
        </div>
        <div className="relative z-10 flex max-w-[440px] flex-col gap-5 self-start">
          <h1 className="m-0 text-[38px] leading-[1.1] font-bold tracking-tight text-white">
            Monitor your sites.<br />Effortlessly.
          </h1>
          <p className="m-0 text-[15px] leading-6 text-white/70">
            Crawl sitemaps, track uptime, detect broken links, and get notified when things change — all in one place.
          </p>
        </div>
        <footer className="relative z-10 text-[12px] text-white/55">
          supacrawl &mdash; open-source site monitoring
        </footer>
      </aside>

      <main className="flex items-center justify-center bg-background px-6 py-14 lg:px-24">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div className="inline-flex items-center justify-center self-start gap-2 text-foreground lg:hidden">
            <Activity className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">supacrawl</span>
          </div>
          <header className="flex flex-col gap-2">
            <h2 className="m-0 text-[28px] font-bold leading-[1.15] tracking-tight text-foreground">
              {title}
            </h2>
            <p className="m-0 text-[14px] text-muted-foreground">{subtitle}</p>
          </header>
          {children}
        </div>
      </main>
    </div>
  )
}