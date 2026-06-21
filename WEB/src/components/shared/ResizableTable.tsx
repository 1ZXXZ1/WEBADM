'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ResizableColumn {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
}

interface ResizableTableProps {
  columns: ResizableColumn[];
  renderHeader: (col: ResizableColumn, index: number) => React.ReactNode;
  renderCell: (col: ResizableColumn, index: number) => React.ReactNode;
  rowCount: number;
  renderRow: (rowIndex: number) => React.ReactNode;
  onColumnResize?: (key: string, width: number) => void;
}

/**
 * A thin wrapper that adds resize handles to table columns.
 * Usage: Wrap the existing <Table> pattern with this component
 * or use the `useResizableColumns` hook directly.
 */
export function useResizableColumns(initialWidths: Record<string, number> = {}) {
  const [widths, setWidths] = useState<Record<string, number>>(initialWidths);

  const setWidth = useCallback((key: string, width: number) => {
    setWidths(prev => ({ ...prev, [key]: Math.max(40, width) }));
  }, []);

  return { widths, setWidth };
}

/**
 * Resize handle component for table headers.
 * Place inside a <th> or <TableHead> to make it resizable.
 */
export function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const startX = useRef(0);
  const dragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    dragging.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      const delta = moveEvent.clientX - startX.current;
      startX.current = moveEvent.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onResize]);

  return (
    <div
      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/40 active:bg-blue-400/60 transition-colors z-10"
      onMouseDown={handleMouseDown}
    />
  );
}
