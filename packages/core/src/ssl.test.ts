import { describe, expect, it, vi, beforeEach } from "vitest"
import { EventEmitter } from "node:events"
import { checkSsl } from "./ssl.js"

vi.mock("node:tls", () => ({ connect: vi.fn() }))

import { connect as tlsConnect } from "node:tls"

type MockFn = ReturnType<typeof vi.fn>

interface FakeSocket extends EventEmitter {
  end: MockFn
  destroy: MockFn
  setTimeout: MockFn
  getPeerCertificate: MockFn
  fireTimeout: () => void
}

interface TlsConnectOptions {
  host: string
  port: number
  servername: string
  rejectUnauthorized: boolean
}

function makeSocket(): FakeSocket {
  const socket = new EventEmitter() as FakeSocket
  socket.end = vi.fn()
  socket.destroy = vi.fn()
  socket.getPeerCertificate = vi.fn()
  let timeoutCb: (() => void) | undefined
  socket.setTimeout = vi.fn((ms: number, cb: () => void) => {
    timeoutCb = cb
    return socket
  })
  socket.fireTimeout = () => timeoutCb?.()
  return socket
}

/** Configure the mocked tls.connect so `handler` drives the fake socket. */
function stubConnect(handler: (socket: FakeSocket, connected: () => void) => void): FakeSocket {
  const socket = makeSocket()
  vi.mocked(tlsConnect).mockImplementation(((_options: unknown, callback: unknown) => {
    queueMicrotask(() => handler(socket, callback as () => void))
    return socket
  }) as never)
  return socket
}

function certSocket(cert: Record<string, unknown> | undefined | null) {
  return stubConnect((socket, connected) => {
    socket.getPeerCertificate.mockReturnValue(cert)
    socket.emit("secureConnect")
    connected()
  })
}

/** Whole-second date so the source's `new Date(d.toUTCString())` round-trip is lossless. */
function secondsFromNow(days: number): Date {
  return new Date(Math.floor((Date.now() + days * DAY) / 1000) * 1000)
}

const DAY = 86_400_000

beforeEach(() => {
  vi.mocked(tlsConnect).mockReset()
})

describe("checkSsl", () => {
  it("connects to port 443 with SNI and without unauthorized rejection", async () => {
    const socket = certSocket({
      valid_from: secondsFromNow(-15).toUTCString(),
      valid_to: secondsFromNow(45).toUTCString(),
    })
    await checkSsl("example.com")

    expect(vi.mocked(tlsConnect)).toHaveBeenCalledWith(
      {
        host: "example.com",
        port: 443,
        servername: "example.com",
        rejectUnauthorized: false,
      } satisfies TlsConnectOptions,
      expect.any(Function),
    )
    // finish() ends and destroys the socket exactly once each
    expect(socket.end).toHaveBeenCalledTimes(1)
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it("parses certificate fields into an SSL info result on success", async () => {
    const validFrom = secondsFromNow(-15)
    const validUntil = secondsFromNow(45)
    certSocket({
      valid_from: validFrom.toUTCString(),
      valid_to: validUntil.toUTCString(),
      subject: { CN: "example.com" },
      issuer: { O: "Test CA" },
    })

    const info = await checkSsl("example.com")

    expect(info).not.toBeNull()
    expect(info!.validUntil).toBe(validUntil.toISOString())
    expect(info!.validFrom).toBe(validFrom.toISOString())
    expect(info!.issuer).toBe("Test CA")
    expect(info!.subject).toBe("example.com")
    // 45 days out minus the few ms elapsed -> floor lands on 44
    expect(info!.daysRemaining).toBe(44)
  })

  it("defaults issuer/subject to empty strings when they are not objects", async () => {
    certSocket({
      valid_from: secondsFromNow(-1).toUTCString(),
      valid_to: secondsFromNow(10).toUTCString(),
      subject: "example.com",
      issuer: "Some CA",
    })

    const info = await checkSsl("example.com")

    expect(info!.subject).toBe("")
    expect(info!.issuer).toBe("")
  })

  it("resolves null when valid_from is missing or invalid (does not hang or throw)", async () => {
    certSocket({
      valid_to: secondsFromNow(30).toUTCString(),
      subject: { CN: "example.com" },
      issuer: { O: "Test CA" },
    })
    expect(await checkSsl("example.com")).toBeNull()

    certSocket({
      valid_to: secondsFromNow(30).toUTCString(),
      valid_from: "not a date",
    })
    expect(await checkSsl("example.com")).toBeNull()
  })

  it("returns null when the certificate has no valid_to date", async () => {
    certSocket(undefined)
    expect(await checkSsl("example.com")).toBeNull()

    certSocket({})
    expect(await checkSsl("example.com")).toBeNull()

    certSocket(null)
    expect(await checkSsl("example.com")).toBeNull()
  })

  it("returns null when the connection errors", async () => {
    const socket = stubConnect((sock) => {
      sock.emit("error", new Error("ECONNREFUSED"))
    })

    const info = await checkSsl("example.com")

    expect(info).toBeNull()
    expect(socket.destroy).toHaveBeenCalled()
  })

  it("returns null when the handshake times out", async () => {
    const socket = stubConnect(() => {
      /* never connect */
    })

    const pending = checkSsl("example.com", 5000)
    socket.fireTimeout()
    const info = await pending

    expect(info).toBeNull()
    expect(socket.setTimeout).toHaveBeenCalledWith(5000, expect.any(Function))
    expect(socket.destroy).toHaveBeenCalled()
  })

  it("keeps the first settled outcome if a later error fires after success", async () => {
    const socket = certSocket({
      valid_from: secondsFromNow(-1).toUTCString(),
      valid_to: secondsFromNow(30).toUTCString(),
      subject: { CN: "example.com" },
      issuer: { O: "Test CA" },
    })

    const info = await checkSsl("example.com")
    // a late error must not overwrite or crash anything
    socket.emit("error", new Error("late failure"))

    expect(info!.subject).toBe("example.com")
    expect(socket.end).toHaveBeenCalledTimes(1)
  })

  it("uses the given hostname for both host and SNI servername", async () => {
    certSocket({
      valid_from: secondsFromNow(-1).toUTCString(),
      valid_to: secondsFromNow(5).toUTCString(),
    })
    await checkSsl("sub.example.com")

    const options = (vi.mocked(tlsConnect).mock.calls[0]!)[0] as unknown as TlsConnectOptions
    expect(options.host).toBe("sub.example.com")
    expect(options.servername).toBe("sub.example.com")
  })
})
