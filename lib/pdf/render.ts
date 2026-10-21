import "server-only";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { StatementView } from "@/lib/billing/statement";
import { ProposalDocument, type ProposalPdfProps } from "@/lib/pdf/proposal-document";
import { StatementDocument } from "@/lib/pdf/statement-document";
import { SubInvoiceDocument } from "@/lib/pdf/sub-invoice-document";
import type { SubInvoiceView } from "@/lib/subcontract/invoice";

export function renderStatementPdf(statement: StatementView): Promise<Buffer> {
  return renderToBuffer(React.createElement(StatementDocument, { statement }) as Parameters<typeof renderToBuffer>[0]);
}

export function renderProposalPdf(props: ProposalPdfProps): Promise<Buffer> {
  return renderToBuffer(React.createElement(ProposalDocument, props) as Parameters<typeof renderToBuffer>[0]);
}

export function renderSubInvoicePdf(invoice: SubInvoiceView): Promise<Buffer> {
  return renderToBuffer(React.createElement(SubInvoiceDocument, { invoice }) as Parameters<typeof renderToBuffer>[0]);
}
