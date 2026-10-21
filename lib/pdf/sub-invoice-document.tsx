import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import type { SubInvoiceView } from "@/lib/subcontract/invoice";
import { pitchLabel } from "@/lib/subcontract/view";
import { LOGO_PNG_DATA_URL } from "./logo";

const COLORS = { ink: "#1c1917", muted: "#6b6560", rule: "#e7e5e4", accent: "#c2410c", brand: "#ea580c" };

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: COLORS.ink, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  logo: { width: 150, marginBottom: 6 },
  stripe: { height: 4, backgroundColor: COLORS.brand, marginBottom: 16 },
  muted: { color: COLORS.muted },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.accent, textAlign: "right" },
  section: { marginBottom: 16, flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.rule, paddingVertical: 5 },
  colLine: { width: "80%", paddingRight: 8 },
  colAmount: { width: "20%", textAlign: "right" },
  th: { fontFamily: "Helvetica-Bold", color: COLORS.muted },
  totals: { marginTop: 8, alignSelf: "flex-end", width: "40%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  void: { color: COLORS.accent, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  footer: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.rule },
});

/** A labor invoice to the contractor for one subcontract job. */
export function SubInvoiceDocument({ invoice }: { invoice: SubInvoiceView }) {
  const { brand, contractor, job } = invoice;
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
            <Text style={{ textAlign: "right" }}>Issued {formatDate(invoice.issuedOn)}</Text>
            <Text style={{ textAlign: "right" }}>Due {formatDate(invoice.dueOn)}</Text>
          </View>
        </View>
        <View style={styles.stripe} />
        {invoice.status === "void" && <Text style={styles.void}>VOID{invoice.voidReason ? `: ${invoice.voidReason}` : ""}</Text>}

        <View style={styles.section}>
          <View>
            <Text style={styles.muted}>Bill to</Text>
            <Text style={styles.bold}>{contractor.name}</Text>
            {contractor.billingEmail && <Text>{contractor.billingEmail}</Text>}
          </View>
          <View>
            <Text style={[styles.muted, { textAlign: "right" }]}>Job</Text>
            <Text style={{ textAlign: "right" }}>{job.address}</Text>
            <Text style={{ textAlign: "right" }}>
              {formatDate(job.workDate)} · {job.squares} squares · {pitchLabel(job.pitch)} pitch
            </Text>
          </View>
        </View>

        <View style={[styles.row, { borderBottomColor: COLORS.ink }]}>
          <Text style={[styles.colLine, styles.th]}>Labor</Text>
          <Text style={[styles.colAmount, styles.th]}>Amount</Text>
        </View>
        {invoice.lines.map((line, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <Text style={styles.colLine}>{line.description}</Text>
            <Text style={styles.colAmount}>{formatCents(line.amountCents)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
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
          <Text style={styles.muted}>Please include invoice #{invoice.number} with your payment. Labor only; materials by others.</Text>
        </View>
      </Page>
    </Document>
  );
}
