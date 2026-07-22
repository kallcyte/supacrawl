import { resolve } from "node:path"
import chalk from "chalk"

interface UserOpts {
  email?: string
  password?: string
  name?: string
  admin?: boolean
  db: string
  id?: string
  role?: string
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) {
    console.error(chalk.red(`Missing env var: ${name}`))
    process.exit(1)
  }
  return v
}

export async function userCommand(
  action: string,
  ...args: unknown[]
): Promise<void> {
  const opts = (args[0] ?? {}) as UserOpts
  const dbPath = resolve(opts.db)
  const serverUrl = env("SUPACRAWL_SERVER_URL", "http://127.0.0.1:3000")
  const token = env("SUPACRAWL_ADMIN_TOKEN", "")

  const url = `${serverUrl}/api/admin/users${action === "list" ? "" : ""}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  try {
    let res: Response
    switch (action) {
      case "create":
        if (!opts.email || !opts.password) {
          console.error(chalk.red("--email and --password are required"))
          process.exit(1)
        }
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            email: opts.email,
            password: opts.password,
            name: opts.name ?? opts.email.split("@")[0],
            role: opts.admin ? "admin" : "user"
          })
        })
        break
      case "list":
        res = await fetch(url, { method: "GET", headers })
        break
      case "delete": {
        const id = String(args[1] ?? "")
        if (!id) {
          console.error(chalk.red("Missing user id"))
          process.exit(1)
        }
        res = await fetch(`${url}/${encodeURIComponent(id)}`, { method: "DELETE", headers })
        break
      }
      case "set-role": {
        const id = String(args[1] ?? "")
        const role = String(args[2] ?? "")
        if (!id || !role) {
          console.error(chalk.red("Missing id or role"))
          process.exit(1)
        }
        res = await fetch(`${url}/${encodeURIComponent(id)}/role`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ role })
        })
        break
      }
      default:
        console.error(chalk.red(`Unknown user action: ${action}`))
        process.exit(1)
    }
    if (!res) return
    const text = await res.text()
    if (!res.ok) {
      console.error(chalk.red(`Server error: ${res.status} ${text}`))
      process.exit(1)
    }
    if (action === "list") {
      const users = JSON.parse(text) as { id: string; email: string; name: string; role: string }[]
      if (users.length === 0) {
        console.log(chalk.gray("No users"))
        return
      }
      for (const u of users) {
        console.log(`${u.id}  ${u.email}  ${u.name}  ${chalk.cyan(u.role)}`)
      }
    } else {
      console.log(chalk.green(text))
    }
  } catch (err) {
    console.error(chalk.red(`Failed to contact server at ${serverUrl}: ${(err as Error).message}`))
    console.error(chalk.gray("Tip: set SUPACRAWL_SERVER_URL or ensure the server is running."))
    process.exit(1)
  }
  void dbPath
}
