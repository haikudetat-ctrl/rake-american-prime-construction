import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { QuickInvoiceView } from "@/lib/billing/quick-invoice";
import { quantityText } from "@/lib/billing/quick-invoice";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { LOGO_PNG_DATA_URL } from "./logo";

// Same look as the contractor invoice, so every invoice from Rake reads alike.
const COLORS = { ink: "#1c1917", muted: "#6b6560", rule: "#e7e5e4", accent: "#c2410c", brand: "#ea580c" };

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: COLORS.ink, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  logo: { width: 150, marginBottom: 6 },
  stripe: { height: 4, backgroundColor: COLORS.brand, marginBottom: 16 },
  muted: { color: COLORS.muted },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.accent, textAlign: "right" },
  draft: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.muted, textAlign: "right" },
  section: { marginBottom: 16, flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.rule, paddingVertical: 5 },
  colLine: { width: "55%", paddingRight: 8 },
  colQty: { width: "25%", textAlign: "right", paddingRight: 8 },
  colAmount: { width: "20%", textAlign: "right" },
  th: { fontFamily: "Helvetica-Bold", color: COLORS.muted },
  totals: { marginTop: 8, alignSelf: "flex-end", width: "40%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  void: { color: COLORS.accent, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  memo: { marginBottom: 12 },
  footer: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.rule },
});

const pct = (n: number) => `${Number(n.toFixed(3))}%`;

/** A one-off invoice under the brand it was made for. A draft says so on its face. */
export function QuickInvoiceDocument({ invoice, today }: { invoice: QuickInvoiceView; today: string }) {
  const { brand, billTo } = invoice;
  const draft = invoice.status === "draft";
  return (
    <Document title={`Invoice ${invoice.number}`} author={brand.name}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            <Image src={LOGO_PNG_DATA_URL} style={styles.logo} />
            <Text style={styles.brand}>{brand.name}</Text>
            {brand.address && <Text style={styles.muted}>{brand.address}</Text>}
            {brand.phone && <Text style={styles.muted}>{formatPhone(brand.phone)}</Text>}
            {brand.email && <Text style={styles.muted}>{brand.email}</Text>}
          </View>
          <View>
            <Text style={styles.title}>INVOICE #{invoice.number}</Text>
            {draft && <Text style={styles.draft}>DRAFT, NOT SENT</Text>}
            <Text style={{ textAlign: "right" }}>Issued {formatDate(invoice.issuedOn ?? today)}</Text>
            <Text style={{ textAlign: "right" }}>Due {formatDate(invoice.dueOn)}</Text>
          </View>
        </View>
        <View style={styles.stripe} />
        {invoice.status === "void" && <Text style={styles.void}>VOID{invoice.voidReason ? `: ${invoice.voidReason}` : ""}</Text>}

        <View style={styles.section}>
          <View>
            <Text style={styles.muted}>Bill to</Text>
            <Text style={styles.bold}>{billTo.name}</Text>
            {billTo.address && <Text>{billTo.address}</Text>}
            {billTo.phone && <Text>{formatPhone(billTo.phone)}</Text>}
            {billTo.email && <Text>{billTo.email}</Text>}
          </View>
        </View>

        {invoice.memo && <Text style={styles.memo}>{invoice.memo}</Text>}

        <View style={[styles.row, { borderBottomColor: COLORS.ink }]}>
          <Text style={[styles.colLine, styles.th]}>Description</Text>
          <Text style={[styles.colQty, styles.th]}>Qty × price</Text>
          <Text style={[styles.colAmount, styles.th]}>Amount</Text>
        </View>
        {invoice.lines.map((line, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.colLine}>{line.description}</Text>
            <Text style={styles.colQty}>{quantityText(line, formatCents)}</Text>
            <Text style={styles.colAmount}>{formatCents(line.amountCents)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          {invoice.taxCents > 0 && (
            <>
              <View style={styles.totalRow}><Text>Subtotal</Text><Text>{formatCents(invoice.subtotalCents)}</Text></View>
              <View style={styles.totalRow}><Text>Sales tax {pct(invoice.taxPct)}</Text><Text>{formatCents(invoice.taxCents)}</Text></View>
            </>
          )}
          <View style={styles.totalRow}><Text>Total</Text><Text>{formatCents(invoice.totalCents)}</Text></View>
          {invoice.paidCents > 0 && (
            <View style={styles.totalRow}><Text>Paid</Text><Text>−{formatCents(invoice.paidCents)}</Text></View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.bold}>Balance due</Text>
            <Text style={styles.bold}>{formatCents(invoice.balanceCents)}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.bold}>How to pay</Text>
          <Text>
            Check payable to {brand.name}
            {brand.address ? `, mailed to ${brand.address}` : ""}, or ACH; call or reply for bank details.
          </Text>
          <Text style={styles.muted}>Please include invoice #{invoice.number} with your payment.</Text>
        </View>
      </Page>
    </Document>
  );
}
