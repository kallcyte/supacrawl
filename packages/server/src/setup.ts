import Database from "better-sqlite3"
import type { Auth } from "./auth.js"
import type { Storage } from "@supacrawl/core"

export class SetupService {
  private _initialized = false

  constructor(
    private dbPath: string,
    private auth: Auth,
    private storage: Storage
  ) {}

  private initDb(): Database.Database {
    const db = new Database(this.dbPath)
    db.pragma("journal_mode = WAL")
    return db
  }

  async hasUsers(): Promise<boolean> {
    try {
      const db = this.initDb()
      const row = db.prepare("SELECT COUNT(*) AS cnt FROM user").get() as { cnt: number } | undefined
      db.close()
      return (row?.cnt ?? 0) > 0
    } catch {
      return false
    }
  }

  isRegistrationOpen(): boolean {
    const val = this.storage.getSetting("allowRegistration")
    return val === "true"
  }

  setRegistrationOpen(open: boolean): void {
    this.storage.setSetting("allowRegistration", open ? "true" : "false")
  }

  async createFirstAdmin(email: string, password: string, name?: string): Promise<{ id: string; email: string }> {
    const has = await this.hasUsers()
    if (has) {
      throw new Error("Admin user already exists")
    }
    // Run better-auth migrations to create tables
    const ctx = await this.auth.$context
    if (typeof ctx.runMigrations === "function") {
      await ctx.runMigrations()
    }

    const result = await this.auth.api.signUpEmail({
      body: { email, password: password, name: name ?? email.split("@")[0] },
      headers: new Headers()
    })

    const db = this.initDb()
    db.prepare("UPDATE user SET role = ? WHERE email = ?").run("admin", email)
    db.close()

    return { id: (result.user as { id: string }).id, email }
  }

  async registerUser(email: string, password: string, name?: string): Promise<{ id: string; email: string }> {
    if (!this.isRegistrationOpen()) {
      throw new Error("Registration is closed")
    }
    // Run migrations if needed
    const ctx = await this.auth.$context
    if (typeof ctx.runMigrations === "function") {
      await ctx.runMigrations()
    }
    const result = await this.auth.api.signUpEmail({
      body: { email, password: password, name: name ?? email.split("@")[0] },
      headers: new Headers()
    })
    return { id: (result.user as { id: string }).id, email }
  }
}
