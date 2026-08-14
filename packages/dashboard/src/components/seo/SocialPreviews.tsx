import type { SeoInfo } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Facebook,
  Twitter,
  Linkedin,
  Slack,
  MessageSquare,
  Send,
  ImageOff
} from "lucide-react"
import { useEffect, useState } from "react"
import { faviconUrl } from "@/lib/utils"

interface Props {
  seo: SeoInfo | null
  finalUrl: string | null
}

/* -------------------------------------------------------------------------- */
/*  Shared image slot — used by every platform card so "no image" and         */
/*  "image failed to load" always render the same broken-state UI.            */
/* -------------------------------------------------------------------------- */

function PreviewImage({
  image,
  aspectClass,
  rounded = "",
  label = "No preview image"
}: {
  image: string | null
  aspectClass: string
  rounded?: string
  label?: string
}) {
  const [failed, setFailed] = useState(false)

  // Reset the broken/failed state whenever the image URL itself changes —
  // otherwise a stale `failed: true` from a previous (or null) image
  // sticks around and keeps showing the placeholder even after a valid
  // og:image comes in.
  useEffect(() => {
    setFailed(false)
  }, [image])

  const broken = !image || failed

  if (broken) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 border border-dashed border-black/10 bg-muted/60 text-muted-foreground ${aspectClass} ${rounded}`}
      >
        <ImageOff className="h-5 w-5 opacity-60" />
        <span className="text-[10px] font-medium opacity-70">{label}</span>
      </div>
    )
  }

  return (
    <div className={`${aspectClass} ${rounded} overflow-hidden`}>
      <img
        src={image}
        alt=""
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

function hideImg(e: React.SyntheticEvent<HTMLImageElement>) {
  ;(e.target as HTMLImageElement).style.display = "none"
}

function NetworkLabel({
  name,
  icon,
  color
}: {
  name: string
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span className="flex h-4 w-4 items-center justify-center" style={{ color }}>
        {icon}
      </span>
      {name}
    </div>
  )
}

export default function SocialPreviews({ seo, finalUrl }: Props) {
  const url = finalUrl ?? ""
  let domain = url
  try {
    domain = new URL(url).hostname.replace(/^www\./, "")
  } catch {
    /* keep raw */
  }
  const image = seo?.ogImage ?? seo?.twitterImage ?? null
  const title = truncate(seo?.ogTitle ?? seo?.twitterTitle ?? seo?.title ?? "(no title)", 90)
  const description = truncate(
    seo?.ogDescription ?? seo?.twitterDescription ?? seo?.description ?? "(no description)",
    200
  )
  const siteName = seo?.ogSiteName ?? domain
  const themeColor = seo?.themeColor ?? "#5865F2"
  const hasSize = Boolean(seo?.ogImageWidth && seo?.ogImageHeight)
  const largeImage = hasSize ? (seo?.ogImageWidth ?? 0) > (seo?.ogImageHeight ?? 0) : true

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Twitter className="h-4 w-4 text-muted-foreground" />
          Social media previews
        </CardTitle>
        <CardDescription>How shared links render on popular platforms</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <FacebookPreview image={image} title={title} description={description} domain={domain} />
          <TwitterPreview image={image} title={title} domain={domain} />
          <LinkedInPreview image={image} title={title} domain={domain} />
          <WhatsAppPreview image={image} title={title} description={description} domain={domain} />
          <SlackPreview image={image} title={title} description={description} domain={domain} siteName={siteName} />
          <DiscordPreview
            image={image}
            title={title}
            description={description}
            domain={domain}
            siteName={siteName}
            themeColor={themeColor}
            largeImage={largeImage}
          />
          <TelegramPreview image={image} title={title} description={description} domain={domain} siteName={siteName} />
        </div>
      </CardContent>
    </Card>
  )
}

interface CardProps {
  image: string | null
  title: string
  description: string
  domain: string
}

/* -------------------------------- Facebook -------------------------------- */
/* White card, thin #dadde1 border, image on top, grey footer strip with      */
/* uppercase domain, bold title, muted description.                          */

function FacebookPreview({ image, title, description, domain }: CardProps) {
  return (
    <div className="min-w-0">
      <NetworkLabel name="Facebook" icon={<Facebook className="h-3.5 w-3.5" />} color="#1877F2" />
      <div className="overflow-hidden rounded-md border border-[#dadde1] bg-white shadow-sm">
        <PreviewImage image={image} aspectClass="aspect-[1.91/1] w-full" />
        <div className="border-t border-[#dadde1] bg-[#f0f2f5] px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-[#606770]">{domain}</p>
          <p className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-tight text-[#050505]">{title}</p>
          <p className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-[#606770]">{description}</p>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------- X / Twitter ------------------------------ */
/* X now renders the same large-image layout regardless of the declared       */
/* twitter:card type, so we do too: image on top with an overlay title pill,  */
/* "From {domain}" underneath.                                                */

function TwitterPreview({ image, title, domain }: Omit<CardProps, "description">) {
  return (
    <div className="min-w-0">
      <NetworkLabel name="X (Twitter)" icon={<Twitter className="h-3.5 w-3.5" />} color="#000000" />
      <div className="w-full">
        <div className="relative overflow-hidden rounded-2xl border border-[#cfd9de]">
          <PreviewImage image={image} aspectClass="aspect-[1.91/1] w-full" />
          <span className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-black/70 px-2.5 py-1 text-[13px] font-medium text-white">
            {title}
          </span>
        </div>
        <p className="mt-1.5 truncate text-[13px] text-gray-500">From {domain}</p>
      </div>
    </div>
  )
}

/* -------------------------------- LinkedIn --------------------------------- */
/* LinkedIn's real unfurl shows image + bold title only, plus a small domain  */
/* line — no description text.                                                */

function LinkedInPreview({ image, title, domain }: { image: string | null; title: string; domain: string }) {
  return (
    <div className="min-w-0">
      <NetworkLabel name="LinkedIn" icon={<Linkedin className="h-3.5 w-3.5" />} color="#0A66C2" />
      <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm">
        <PreviewImage image={image} aspectClass="aspect-[1.91/1] w-full" />
        <div className="px-3 py-2">
          <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#000000e0]">{title}</p>
          <p className="mt-1 truncate text-xs text-[#00000099]">{domain}</p>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------- WhatsApp ---------------------------------- */
/* Message-bubble style: green bubble, white inner card, thumbnail on top,     */
/* bold title, muted description, uppercase domain footer.                     */

function WhatsAppPreview({ image, title, description, domain }: CardProps) {
  return (
    <div className="min-w-0">
      <NetworkLabel name="WhatsApp" icon={<MessageSquare className="h-3.5 w-3.5" />} color="#25D366" />
      <div className="rounded-xl bg-[#d9fdd3] p-1.5 shadow-sm">
        <div className="overflow-hidden rounded-lg bg-white">
          <PreviewImage image={image} aspectClass="aspect-[1.91/1] w-full" />
          <div className="px-2.5 py-2">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-gray-900">{title}</p>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-gray-500">{description}</p>
            <p className="mt-1 text-[11px] uppercase text-gray-400">{domain}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------- Slack ------------------------------------ */
/* Unfurl block: grey vertical accent bar, favicon + site name, blue title     */
/* link, description, image thumbnail.                                        */

function SlackPreview({ image, title, description, domain, siteName }: CardProps & { siteName: string }) {
  return (
    <div className="min-w-0">
      <NetworkLabel name="Slack" icon={<Slack className="h-3.5 w-3.5" />} color="#4A154B" />
      <div className="flex gap-2.5 rounded-md border border-black/5 bg-white p-3 pl-2.5 shadow-sm">
        <div className="w-1 shrink-0 rounded-full bg-[#dddde3]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <img src={faviconUrl(`https://${domain}`)} alt="" className="h-4 w-4 rounded-sm" onError={hideImg} />
            <span className="truncate">{siteName}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug text-[#1264a3]">{title}</p>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-gray-700">{description}</p>
          <PreviewImage image={image} aspectClass="mt-2 aspect-[1.91/1] w-full max-w-[280px]" rounded="rounded" />
        </div>
      </div>
    </div>
  )
}

/* --------------------------------- Discord ----------------------------------- */
/* Embed block: colored left bar, small site-name line, bold white title,       */
/* description, large image below or small square thumb for non-large images.   */

function DiscordPreview({
  image,
  title,
  description,
  domain,
  siteName,
  themeColor,
  largeImage
}: CardProps & { siteName: string; themeColor: string; largeImage: boolean }) {
  return (
    <div className="min-w-0">
      <NetworkLabel name="Discord" icon={<MessageSquare className="h-3.5 w-3.5" />} color="#5865F2" />
      <div
        className="max-w-[400px] rounded-[3px] bg-[#2b2d31] py-2 pr-3 shadow-sm"
        style={{ borderLeft: `4px solid ${themeColor}`, paddingLeft: "12px" }}
      >
        <p className="truncate text-[12px] font-medium text-[#00a8fc]">{domain}</p>
        <p className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-[#f2f3f5]">{title}</p>
        <p className="mt-1 line-clamp-3 text-[13px] leading-[1.35] text-[#dbdee1]">{description}</p>
        {largeImage ? (
          <PreviewImage image={image} aspectClass="mt-2 aspect-[1.91/1] w-full" rounded="rounded-[4px]" />
        ) : (
          <div className="mt-2 flex justify-start">
            <PreviewImage image={image} aspectClass="h-20 w-20 shrink-0" rounded="rounded-[4px]" />
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- Telegram ------------------------------------ */
/* Blue accent bar, site name, bold title, description, full-width thumbnail     */
/* below the text — matches Telegram's article-style link preview.               */

function TelegramPreview({ image, title, description, domain, siteName }: CardProps & { siteName: string }) {
  return (
    <div className="min-w-0">
      <NetworkLabel name="Telegram" icon={<Send className="h-3.5 w-3.5" />} color="#2AABEE" />
      <div className="flex gap-2.5 rounded-lg border border-black/10 bg-white p-2.5 shadow-sm">
        <div className="w-[3px] shrink-0 rounded-full bg-[#40a7e3]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#40a7e3]">{siteName || domain}</p>
          <p className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug text-gray-900">{title}</p>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-gray-500">{description}</p>
          <PreviewImage image={image} aspectClass="mt-2 aspect-[1.91/1] w-full" rounded="rounded-md" />
        </div>
      </div>
    </div>
  )
}
