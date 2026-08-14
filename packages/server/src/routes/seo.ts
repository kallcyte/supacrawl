import type { Hono } from "hono"
import { z } from "zod"
import type { RouteDeps } from "./index.js"
import { requireAuth } from "../auth-helpers.js"
import { checkSeo, scoreSeo } from "@supacrawl/core"

const checkSchema = z.object({
  url: z.string().url("A valid URL is required")
})

export function seoRoutes(app: Hono, deps: RouteDeps): void {
  app.post("/api/seo/check", async (c) => {
    const session = await requireAuth(c, deps.auth)
    if (!session) return c.json({ error: "Unauthorized" }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400)
    }
    const parsed = checkSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400)
    }
    const analysis = await checkSeo(parsed.data.url, {
      userAgent: deps.config.crawl.userAgent
    })
    const { score, categories, audits } = scoreSeo(analysis)
    return c.json({ analysis, score, categories, audits })
  })
}
