import { createHash } from "node:crypto";

/**
 * Pure mapping from a Rake invoice to a QuickBooks Online Invoice body
 * (Accounting API, entity "Invoice"). No I/O here, so it is unit-tested.
 */

export type LineKind = "delivery" | "extended_days" | "tonnage" | "adjustment";

export type ItemMapping = Record<LineKind, string | null>;

export const LINE_KIND_LABEL: Record<LineKind, string> = {
  delivery: "Delivery / rental",
  extended_days: "Extra days",
  tonnage: "Tonnage",
  adjustment: "Adjustments and credits",
};

export type RakeInvoice = {
  number: number;
  issuedOn: string; // statement issue date, YYYY-MM-DD
  dueOn: string;
  statementNumber: number;
  siteAddress: string | null;
  lines: { kind: LineKind; description: string; quantity: number; unitCents: number | null; amountCents: number }[];
};

export type QboInvoiceBody = {
  CustomerRef: { value: string };
  DocNumber: string;
  TxnDate: string;
  DueDate: string;
  PrivateNote: string;
  Line: {
    DetailType: "SalesItemLineDetail";
    Amount: number;
    Description: string;
    SalesItemLineDetail: { ItemRef: { value: string }; Qty?: number; UnitPrice?: number };
  }[];
};

export class MappingMissing extends Error {
  constructor(readonly kinds: LineKind[]) {
    super(`Choose a QuickBooks product/service for: ${kinds.map((k) => LINE_KIND_LABEL[k]).join(", ")} (Settings → QuickBooks).`);
    this.name = "MappingMissing";
  }
}

/**
 * QuickBooks DocNumber for a Rake invoice. Prefixed so it can't collide with
 * invoice numbers already in the company's books (QuickBooks may reject or
 * warn on a duplicate number). Max 21 characters.
 */
export const docNumber = (rakeNumber: number) => `R-${rakeNumber}`;

const dollars = (cents: number) => Math.round(cents) / 100;

export function invoiceBody(invoice: RakeInvoice, customerRef: string, items: ItemMapping): QboInvoiceBody {
  const missing = [...new Set(invoice.lines.map((l) => l.kind))].filter((k) => !items[k]);
  if (missing.length) throw new MappingMissing(missing);

  return {
    CustomerRef: { value: customerRef },
    DocNumber: docNumber(invoice.number),
    TxnDate: invoice.issuedOn,
    DueDate: invoice.dueOn,
    PrivateNote: [`Rake invoice ${invoice.number}, statement ${invoice.statementNumber}`, invoice.siteAddress]
      .filter(Boolean)
      .join(" · "),
    Line: invoice.lines.map((line) => {
      const detail: QboInvoiceBody["Line"][number]["SalesItemLineDetail"] = { ItemRef: { value: items[line.kind]! } };
      // QuickBooks rejects a line whose Qty × UnitPrice differs from Amount, so
      // only send them when they multiply out exactly (in cents).
      if (line.unitCents != null && Math.round(line.quantity * line.unitCents) === line.amountCents) {
        detail.Qty = line.quantity;
        detail.UnitPrice = dollars(line.unitCents);
      }
      return {
        DetailType: "SalesItemLineDetail",
        Amount: dollars(line.amountCents),
        Description: line.description,
        SalesItemLineDetail: detail,
      };
    }),
  };
}

/** Digest of what would be sent; unchanged digest means nothing to update. */
export function bodyHash(body: QboInvoiceBody): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

/** QuickBooks query strings quote with single quotes, escaped with a backslash. */
export function quoteQuery(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Amount QuickBooks shows as paid on an invoice, in cents. */
export function paidCents(invoice: { TotalAmt?: number; Balance?: number }): number {
  const total = Math.round((invoice.TotalAmt ?? 0) * 100);
  const balance = Math.round((invoice.Balance ?? 0) * 100);
  return Math.max(0, total - balance);
}

/** QuickBooks DisplayName: unique per company, at most 500 characters, no colons, tabs or newlines. */
export function displayName(name: string): string {
  return name.replace(/[:\t\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}
