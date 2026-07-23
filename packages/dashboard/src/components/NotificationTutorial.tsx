import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

interface TutorialProps {
  provider: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <div className="text-sm leading-relaxed text-foreground/85">{children}</div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground/90">
      {children}
    </code>
  )
}

const tutorials: Record<string, { title: string; steps: React.ReactNode[] }> = {
  slack: {
    title: "Slack Setup",
    steps: [
      <>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">api.slack.com/apps</a> and click <strong>Create New App</strong> → <strong>From scratch</strong>.</>,
      <>Name your app and select the workspace where notifications will appear.</>,
      <>In the left sidebar, navigate to <strong>Incoming Webhooks</strong>.</>,
      <>Toggle <strong>Activate Incoming Webhooks</strong> to <strong>On</strong>.</>,
      <>Click <strong>Add New Webhook to Workspace</strong>, choose a channel, and click <strong>Allow</strong>.</>,
      <>Copy the <strong>Webhook URL</strong> and add it to your <Code>supacrawl.config.json</Code> under <Code>notifications.providers.slack.webhookUrl</Code>.</>
    ]
  },
  telegram: {
    title: "Telegram Setup",
    steps: [
      <>Open Telegram and search for <strong>@BotFather</strong>.</>,
      <>Send <Code>/newbot</Code> and follow the prompts to create a new bot. You will receive a <strong>bot token</strong>.</>,
      <>Search for your bot's username on Telegram and send it any message to start a chat.</>,
      <>Visit <Code>https://api.telegram.org/bot&lt;YOUR_BOT_TOKEN&gt;/getUpdates</Code> in your browser.</>,
      <>Look for the <Code>chat</Code> object in the JSON response and copy the <Code>id</Code> value — that is your <strong>chat ID</strong>.</>,
      <>Add the <strong>bot token</strong> and <strong>chat ID</strong> to your <Code>supacrawl.config.json</Code> under <Code>notifications.providers.telegram</Code>.</>
    ]
  },
  email: {
    title: "Email (SMTP) Setup",
    steps: [
      <>Obtain SMTP credentials from your email provider. Common options:</>,
      <>
        <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-foreground/75">
          <li><strong>Gmail</strong> — enable 2FA then create an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">App Password</a></li>
          <li><strong>SendGrid</strong> — create an API key with "Mail Send" permission</li>
          <li><strong>Mailgun</strong> — use your SMTP credentials from the Domains tab</li>
          <li><strong>SMTP2GO</strong> — use your account username and password</li>
        </ul>
      </>,
      <>Configure the SMTP host and port (587 for TLS, 465 for SSL) in <Code>notifications.providers.email.smtp</Code>.</>,
      <>Set <Code>notifications.providers.email.from</Code> to the sender address and <Code>notifications.providers.email.to</Code> to a comma-separated list of recipients.</>,
      <>Restart the server and use <strong>Send test</strong> to verify delivery.</>
    ]
  },
  webhook: {
    title: "Generic Webhook Setup",
    steps: [
      <>Set up an HTTP endpoint that accepts <strong>POST</strong> requests with <Code>Content-Type: application/json</Code>.</>,
      <>Add the endpoint URL to your <Code>supacrawl.config.json</Code> under <Code>notifications.providers.webhook.url</Code>.</>,
      <>Optionally set an <strong>HMAC-SHA256 secret</strong> under <Code>notifications.providers.webhook.secret</Code>. If set, each payload will include an <Code>X-Signature-256</Code> header you can verify.</>,
      <>The payload shape is:</>,
      <>
        <pre className="overflow-x-auto rounded bg-muted p-3 text-xs font-mono text-foreground/80">
{`{
  "event": "crawl_failure" | "content_change" | "ssl_expiring" | "crawl_complete",
  "message": "…",
  "timestamp": "2025-01-01T00:00:00Z"
}`}
        </pre>
      </>,
      <>Restart the server and use <strong>Send test</strong> to verify your endpoint receives the payload.</>
    ]
  }
}

export default function NotificationTutorial({ provider, open, onOpenChange }: TutorialProps) {
  const tutorial = tutorials[provider]
  if (!tutorial) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{tutorial.title}</DialogTitle>
          <DialogDescription>
            Step-by-step guide to set up {provider} notifications
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {tutorial.steps.map((step, i) => (
            <Step key={i} n={i + 1}>{step}</Step>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
