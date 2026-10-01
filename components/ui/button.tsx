import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-[14px] border border-transparent text-sm font-semibold whitespace-nowrap transition-[transform,background,border-color,box-shadow,color] duration-200 outline-none hover:-translate-y-px active:translate-y-0 active:scale-[0.985] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-lime-200/40 bg-[linear-gradient(135deg,#d8ff52,#9fe83f)] text-[#060806] shadow-[0_10px_26px_rgba(190,255,60,0.16),inset_0_1px_0_rgba(255,255,255,0.42)] hover:border-lime-100/80 hover:bg-[linear-gradient(135deg,#e4ff7a,#b4f34e)] hover:shadow-[0_14px_34px_rgba(190,255,60,0.24),inset_0_1px_0_rgba(255,255,255,0.5)]",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border-white/[0.14] bg-[linear-gradient(145deg,rgba(255,255,255,0.045),rgba(0,0,0,0.2))] text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-lime-300/40 hover:bg-lime-300/[0.07] hover:text-lime-100 hover:shadow-[0_0_24px_rgba(190,255,60,0.08)]",
        secondary:
          "border-cyan-300/20 bg-[linear-gradient(145deg,rgba(34,211,238,0.1),rgba(0,0,0,0.2))] text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-cyan-200/45 hover:bg-cyan-300/[0.14]",
        ghost:
          "border-transparent bg-transparent text-slate-400 hover:border-white/[0.08] hover:bg-white/[0.045] hover:text-lime-100",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
