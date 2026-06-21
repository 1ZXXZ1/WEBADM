"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

/**
 * Safely convert any value to a string for toast messages.
 * Prevents "Objects are not valid as a React child" errors
 * when API error objects {type, loc, msg, input} are passed directly.
 */
function safeStringify(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (obj.msg) return String(obj.msg);
        if (obj.message) return String(obj.message);
        try { return JSON.stringify(item); } catch { return String(item); }
      }
      return String(item);
    }).join('; ');
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.msg) return String(obj.msg);
    if (obj.message) return String(obj.message);
    if (obj.detail) return safeStringify(obj.detail);
    try { return JSON.stringify(val); } catch { return String(val); }
  }
  return String(val);
}

export { Toaster, safeStringify }
