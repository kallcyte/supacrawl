import * as React from "react"

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange"> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    return (
      <label className={`relative inline-flex h-6 w-11 cursor-pointer items-center ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className ?? ""}`}>
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          ref={ref}
          {...props}
        />
        <span className="absolute inset-0 rounded-full bg-muted-foreground/30 transition peer-checked:bg-primary peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${checked ? "translate-x-5" : ""}`}
        />
      </label>
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
