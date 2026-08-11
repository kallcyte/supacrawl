import { connect as tlsConnect } from "node:tls"

export interface SslInfo {
  validUntil: string
  validFrom: string
  issuer: string
  subject: string
  daysRemaining: number
}

export async function checkSsl(host: string, timeoutMs = 10000): Promise<SslInfo | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (v: SslInfo | null) => {
      if (settled) return
      settled = true
      try {
        socket.end()
        socket.destroy()
      } catch {
        /* noop */
      }
      resolve(v)
    }
    const url = new URL(`https://${host}`)
    const socket = tlsConnect(
      {
        host: url.hostname,
        port: 443,
        servername: url.hostname,
        rejectUnauthorized: false
      },
      () => {
        const cert = socket.getPeerCertificate()
        if (!cert || !cert.valid_to) {
          finish(null)
          return
        }
        const validUntil = new Date(cert.valid_to)
        const validFrom = new Date(cert.valid_from)
        const now = new Date()
        const daysRemaining = Math.floor((validUntil.getTime() - now.getTime()) / 86400000)
        finish({
          validUntil: validUntil.toISOString(),
          validFrom: validFrom.toISOString(),
          issuer: typeof cert.issuer === "object" ? (cert.issuer as Record<string, string>).O ?? "" : "",
          subject:
            typeof cert.subject === "object" ? (cert.subject as Record<string, string>).CN ?? "" : "",
          daysRemaining
        })
      }
    )
    socket.setTimeout(timeoutMs, () => finish(null))
    socket.on("error", () => finish(null))
  })
}
