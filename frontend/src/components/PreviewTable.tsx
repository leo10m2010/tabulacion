import { cn } from "../lib/utils";
import type { TableRows } from "../lib/types";

export function PreviewTable({ rows, maxRows = 12 }: { rows: TableRows; maxRows?: number }) {
  if (!rows.length) {
    return <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Sin datos para mostrar.</p>;
  }
  const header = rows[0] ?? [];
  const body = rows.slice(1, maxRows + 1);
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-muted/70">
          <tr>
            {header.map((cell, idx) => (
              <th key={`h-${idx}`} className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">
                {String(cell ?? "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`r-${rowIndex}`} className="odd:bg-background even:bg-muted/30">
              {header.map((_, colIndex) => (
                <td key={`c-${rowIndex}-${colIndex}`} className="border-b border-border/70 px-3 py-2 text-muted-foreground">
                  {String(row[colIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

