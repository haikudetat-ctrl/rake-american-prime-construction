import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import type { SubStatementView } from "@/lib/subcontract/statement";
import { periodText } from "@/lib/subcontract/view";
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
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.rule, paddingVertical: 4 },
  colInvoice: { width: "12%" },
  colJob: { width: "30%", paddingRight: 8 },
  colLine: { width: "42%", paddingRight: 8 },
  colAmount: { width: "16%", textAlign: "right" },
  th: { fontFamily: "Helvetica-Bold", color: COLORS.muted },
  jobTotal: { flexDirection: "row", justifyContent: "flex-end", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: COLORS.ink },
  totals: { marginTop: 8, alignSelf: "flex-end", width: "40%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  void: { color: COLORS.accent, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  footer: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.rule },
});

/** One statement to a contractor: every job of the week, each with its invoice's lines. */
export function SubStatementDocument({ statement }: { statement: SubStatementView }) {
  const { brand, contractor } = statement;
  return (
    <Document title={`Statement ${statement.number}`} author={brand.name}>
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
            <Text style={styles.title}>STATEMENT #{statement.number}</Text>
            <Text style={{ textAlign: "right" }}>Issued {formatDate(statement.issuedOn)}</Text>
            <Text style={{ textAlign: "right" }}>Due {formatDate(statement.dueOn)}</Text>
          </View>
        </View>
        <View style={styles.stripe} />
        {statement.status === "void" && <Text style={styles.void}>VOID{statement.voidReason ? `: ${statement.voidReason}` : ""}</Text>}

        <View style={styles.section}>
          <View>
            <Text style={styles.muted}>Bill to</Text>
            <Text style={styles.bold}>{contractor.name}</Text>
            {contractor.billingEmail && <Text>{contractor.billingEmail}</Text>}
          </View>
          <View>
            <Text style={[styles.muted, { textAlign: "right" }]}>Work</Text>
            <Text style={{ textAlign: "right" }}>{periodText(statement.periodStart, statement.periodEnd)}</Text>
            <Text style={{ textAlign: "right" }}>{statement.invoices.length} {statement.invoices.length === 1 ? "job" : "jobs"}</Text>
          </View>
        </View>

        <View style={[styles.row, { borderBottomColor: COLORS.ink }]}>
          <Text style={[styles.colInvoice, styles.th]}>Invoice</Text>
          <Text style={[styles.colJob, styles.th]}>Job</Text>
          <Text style={[styles.colLine, styles.th]}>Labor</Text>
          <Text style={[styles.colAmount, styles.th]}>Amount</Text>
        </View>
        {statement.invoices.map((invoice) => (
          <View key={invoice.id} wrap={false}>
            {invoice.lines.map((line, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.colInvoice}>{i === 0 ? `#${invoice.number}` : ""}</Text>
                <View style={styles.colJob}>
                  {i === 0 && <Text>{invoice.address}</Text>}
                  {i === 0 && <Text style={styles.muted}>{formatDate(invoice.workDate)} · {invoice.scope}</Text>}
                </View>
                <Text style={styles.colLine}>{line.description}</Text>
                <Text style={styles.colAmount}>{formatCents(line.amountCents)}</Text>
              </View>
            ))}
            <View style={styles.jobTotal}>
              <Text style={styles.bold}>Invoice #{invoice.number}: {formatCents(invoice.totalCents)}</Text>
            </View>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}><Text>Total</Text><Text>{formatCents(statement.totalCents)}</Text></View>
          {statement.paidCents > 0 && (
            <View style={styles.totalRow}><Text>Paid</Text><Text>−{formatCents(statement.paidCents)}</Text></View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.bold}>Balance due</Text>
            <Text style={styles.bold}>{formatCents(statement.balanceCents)}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.bold}>How to pay</Text>
          <Text>
            One check for the balance, payable to {brand.name}
            {brand.address ? `, mailed to ${brand.address}` : ""}, or ACH; call or reply for bank details.
          </Text>
          <Text style={styles.muted}>Please include statement #{statement.number} with your payment. Labor only; materials by others.</Text>
        </View>
      </Page>
    </Document>
  );
}
