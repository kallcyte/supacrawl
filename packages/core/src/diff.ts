/**
 * SHA-256 hash using Web Crypto API (works in Node 19+, Workers, browsers).
 */
export async function sha256(data: string | Uint8Array): Promise<string> {
  const encoder = new TextEncoder()
  const buf = typeof data === "string" ? encoder.encode(data) : data
  const hashBuffer = await crypto.subtle.digest("SHA-256", buf)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}
