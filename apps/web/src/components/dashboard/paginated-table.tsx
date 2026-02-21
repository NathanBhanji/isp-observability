"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  className?: string;
  render: (row: T, index: number) => React.ReactNode;
  hidden?: boolean;
}

interface PaginatedTableProps<T> {
  title: string;
  description?: string;
  data: T[];
  columns: Column<T>[];
  pageSize?: number;
  rowKey: (row: T, index: number) => string | number;
  rowClassName?: (row: T) => string;
  emptyMessage?: string;
}

export function PaginatedTable<T>({
  title,
  description,
  data,
  columns,
  pageSize = 10,
  rowKey,
  rowClassName,
  emptyMessage = "No data available",
}: PaginatedTableProps<T>) {
  const [page, setPage] = useState(0);

  const visibleColumns = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const totalPages = Math.ceil(data.length / pageSize);
  const pageData = useMemo(
    () => data.slice(page * pageSize, (page + 1) * pageSize),
    [data, page, pageSize]
  );

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, data.length);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {data.length > 0 && (
            <span className="text-xs text-muted-foreground font-mono">
              {data.length} total
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  {visibleColumns.map((col) => (
                    <TableHead
                      key={col.key}
                      className={`h-8 px-2 ${col.align === "right" ? "text-right" : ""} ${col.className || ""}`}
                    >
                      {col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageData.map((row, i) => (
                  <TableRow
                    key={rowKey(row, page * pageSize + i)}
                    className={`text-xs font-mono ${rowClassName?.(row) || ""}`}
                  >
                    {visibleColumns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={`px-2 py-1.5 ${col.align === "right" ? "text-right" : ""} ${col.className || ""}`}
                      >
                        {col.render(row, page * pageSize + i)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                <span className="text-xs text-muted-foreground">
                  {start}–{end} of {data.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
