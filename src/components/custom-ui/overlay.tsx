"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

/**
 * Full-screen overlay built on Radix Dialog primitives.
 *
 * Same API and functionality as Dialog — the only difference is
 * visual: full-screen layout instead of a small centered card.
 *
 * Gives you accessibility for free (focus trap, Escape to close,
 * screen reader title/description).
 */

function Overlay({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="overlay" {...props} />
}

function OverlayTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="overlay-trigger" {...props} />
}

function OverlayPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="overlay-portal" {...props} />
}

function OverlayClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close
    data-slot="overlay-close"
    {...props}/>
}

function OverlayOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="overlay-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function OverlayContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <OverlayPortal data-slot="overlay-portal">
      <OverlayOverlay />
      <DialogPrimitive.Content
        data-slot="overlay-content"
        className={cn(
          "fixed inset-0 z-50 flex flex-col items-center justify-center outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="overlay-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </OverlayPortal>
  )
}

function OverlayHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="overlay-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function OverlayFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="overlay-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function OverlayTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="overlay-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function OverlayDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="overlay-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Overlay,
  OverlayClose,
  OverlayContent,
  OverlayDescription,
  OverlayFooter,
  OverlayHeader,
  OverlayOverlay,
  OverlayPortal,
  OverlayTitle,
  OverlayTrigger,
}
