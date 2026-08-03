import { useState } from "react"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerTitle, DrawerDescription } from "@/components/ui/drawer"
import Markdown from "@/components/Markdown"

interface Props {
  title: string
  description?: string
  content: string
  className?: string
}

export default function PageInfo({ title, description, content, className }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" size="icon" className={className} onClick={() => setOpen(true)} title={`How ${title} works`}>
        <Info className="h-4 w-4" />
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>How {title} works</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <DrawerBody>
            <Markdown content={content} />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  )
}
