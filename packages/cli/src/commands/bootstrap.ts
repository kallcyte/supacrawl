import { resolve } from "node:path"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import chalk from "chalk"

interface BootstrapOpts {
  email: string
  password: string
  name?: string
  db: string
}

export async function bootstrapCommand(opts: BootstrapOpts): Promise<void> {
  if (opts.password.length < 8) {
    console.error(chalk.red("Password must be at least 8 characters"))
    process.exit(1)
  }
  const dbPath = resolve(opts.db)
  mkdirSync(dirname(dbPath), { recursive: true })
  console.log(chalk.blue(`[supacrawl] bootstrapping admin user against ${dbPath}`))

  try {
    const pkg = await import("@supacrawl/server")
    const auth = pkg.createAuth({ databasePath: dbPath })

    // Run migrations to create tables
    const ctx = await auth.$context
    if (typeof ctx.runMigrations === "function") {
      await ctx.runMigrations()
    }

    const result = await auth.api.signUpEmail({
      body: {
        email: opts.email,
        password: opts.password,
        name: opts.name ?? opts.email.split("@")[0]
      },
      headers: new Headers()
    })

    // Upgrade to admin via direct SQL
    const Database = (await import("better-sqlite3")).default
    const db = new Database(dbPath)
    db.prepare("UPDATE user SET role = ? WHERE email = ?").run("admin", opts.email)
    db.close()

    console.log(chalk.green(`Admin user created: ${opts.email}`))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`Bootstrap failed: ${msg}`))
    process.exit(1)
  }
}
