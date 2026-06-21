'use client';

import React, { useRef, useCallback, useEffect } from 'react';

/**
 * Wraps a wide table in a scrollable container that supports BOTH:
 *  - vertical scroll via wheel (native)
 *  - horizontal scroll via wheel + Shift, OR via trackpad horizontal swipe
 *
 * Usage:
 *   <ScrollableTable className="max-h-[calc(100vh-22rem)]">
 *     <Table>...</Table>
 *   </ScrollableTable>
 *
 * The wrapper handles `onWheel` to translate vertical wheel deltas into
 * horizontal scroll when Shift is held, so users can scroll wide audit-style
 * tables left/right with the mouse wheel.
 */
interface ScrollableTableProps {
  children: React.ReactNode;
  className?: string;
  /** Maximum height; defaults to a sane viewport-based value. */
  maxHeight?: string;
}

export default function ScrollableTable({
  children,
  className,
  maxHeight = 'calc(100vh-22rem)',
}: ScrollableTableProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    // Shift + wheel = horizontal scroll (like Excel / Google Sheets)
    if (e.shiftKey) {
      const delta = e.deltaY || e.deltaX;
      if (delta !== 0) {
        el.scrollLeft += delta;
        e.preventDefault();
      }
      return;
    }
    // If the content is wider than the container and the user is wheeling
    // primarily horizontally (deltaX), let the browser handle it natively.
    // Otherwise, normal vertical scroll.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      el.scrollLeft += e.deltaX;
      e.preventDefault();
    }
    // Otherwise: native vertical scroll — do nothing.
  }, []);

  // Make sure focus is set so keyboard arrows work too
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.tabIndex = 0;
  }, []);

  return (
    <div
      ref={ref}
      onWheel={handleWheel}
      className={`overflow-auto overflow-x-auto border rounded-md ${className ?? ''}`}
      style={{ maxHeight, WebkitOverflowScrolling: 'touch' }}
      role="region"
      aria-label="Scrollable table"
    >
      {children}
    </div>
  );
}
