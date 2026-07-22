/**
 * Bootstrap script to create the first admin user.
 * Run via: `pnpm supacrawl bootstrap --email <email> --password <password>`
 * or directly: `node dist/bootstrap.js --email x --password y --db ./data/supacrawl.db`
 */
import { createAuth } from "./auth.js"

async function main() {
  const args = process.argv.slice(2)
  const opts: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a?.startsWith("--")) {
      opts[a.slice(2)] = args[i + 1] ?? ""
      i++
    }
  }
  const email = opts.email
  const password = opts.password
  const name = opts.name
  const db = opts.db ?? "./data/supacrawl.db"
  if (!email || !password) {
    console.error("Usage: bootstrap --email <email> --password <password> [--name <name>] [--db <path>]")
    process.exit(1)
  }
  const auth = createAuth({ databasePath: db })
  try {
    const result = await (auth.api as unknown as {
      createUser: (args: { body: Record<string, unknown>; headers: Headers }) => Promise<unknown>
    }).createUser({
      body: {
        email,
        password,
        name: name ?? email.split("@")[0],
        role: "admin"
      },
      headers: new Headers()
    })
    console.log("Admin user created:", JSON.stringify(result, null, 2))
  } catch (err) {
    console.error("Failed:", (err as Error).message)
    process.exit(1)
  }
}

main()
