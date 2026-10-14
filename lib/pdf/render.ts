import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { StatementView } from "@/lib/billing/statement";
import { StatementDocument } from "@/lib/pdf/statement-document";

export function renderStatementPdf(statement: StatementView): Promise<Buffer> {
  return renderToBuffer(React.createElement(StatementDocument, { statement }) as Parameters<typeof renderToBuffer>[0]);
}
