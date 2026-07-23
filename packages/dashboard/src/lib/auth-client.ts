import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  baseURL: window.location.origin
})

export const { useSession, signIn, signUp, signOut } = authClient

export async function forgetPassword(opts: { email: string }): Promise<{ error?: { message: string } }> {
  try {
    const res = await fetch("/api/auth/custom-forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: opts.email })
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: { message: body.error || "Failed to send reset email" } }
    }
    return {}
  } catch (err) {
    return { error: { message: (err as Error).message } }
  }
}

export async function resetPassword(opts: { newPassword: string; token: string }): Promise<{ error?: { message: string } }> {
  try {
    const res = await fetch("/api/auth/custom-reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: opts.newPassword, token: opts.token })
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: { message: body.error || "Failed to reset password" } }
    }
    return {}
  } catch (err) {
    return { error: { message: (err as Error).message } }
  }
}
