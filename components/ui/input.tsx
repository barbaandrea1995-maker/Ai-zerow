import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-[12px] border border-[#c8ff22]/15 bg-[rgba(3,6,4,0.64)] px-3 py-1 text-base shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-[color,border-color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#747f73] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[0.42] md:text-sm",
        "focus-visible:border-[#d5ff35]/65 focus-visible:ring-[3px] focus-visible:ring-[#c8ff22]/10 focus-visible:shadow-[0_0_18px_rgba(200,255,34,0.12)]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
