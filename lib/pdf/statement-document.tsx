import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { StatementView } from "@/lib/billing/statement";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

const COLORS = { ink: "#1c1c1a", muted: "#6b6b66", rule: "#e2e1dc", accent: "#c2410c" };

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: COLORS.ink, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  muted: { color: COLORS.muted },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.accent, textAlign: "right" },
  section: { marginBottom: 16 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.rule, paddingVertical: 4 },
  colInvoice: { width: "14%" },
  colJob: { width: "36%", paddingRight: 8 },
  colLine: { width: "34%", paddingRight: 8 },
  colAmount: { width: "16%", textAlign: "right" },
  th: { fontFamily: "Helvetica-Bold", color: COLORS.muted },
  totals: { marginTop: 8, alignSelf: "flex-end", width: "40%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.rule },
});

export function StatementDocument({ statement }: { statement: StatementView }) {
  const { brand, customer } = statement;
  return (
    <Document title={`Statement ${statement.number}`} author={brand.name}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
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

        <View style={styles.section}>
          <Text style={styles.muted}>Bill to</Text>
          <Text style={styles.bold}>{customer.name}</Text>
          {customer.billingEmail && <Text>{customer.billingEmail}</Text>}
        </View>

        <View style={[styles.row, { borderBottomColor: COLORS.ink }]}>
          <Text style={[styles.colInvoice, styles.th]}>Invoice</Text>
          <Text style={[styles.colJob, styles.th]}>Job</Text>
          <Text style={[styles.colLine, styles.th]}>Charge</Text>
          <Text style={[styles.colAmount, styles.th]}>Amount</Text>
        </View>
        {statement.invoices.flatMap((invoice) =>
          invoice.lines.map((line, i) => (
            <View key={`${invoice.number}-${i}`} style={styles.row} wrap={false}>
              <Text style={styles.colInvoice}>{i === 0 ? `#${invoice.number}` : ""}</Text>
              <View style={styles.colJob}>
                {i === 0 && <Text>{invoice.address}</Text>}
                {i === 0 && invoice.dates && <Text style={styles.muted}>{invoice.dates}</Text>}
              </View>
              <Text style={styles.colLine}>{line.description}</Text>
              <Text style={styles.colAmount}>{formatCents(line.amountCents)}</Text>
            </View>
          )),
        )}

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
            Check payable to {brand.name}
            {brand.address ? `, mailed to ${brand.address}` : ""}, or ACH — call or reply for bank details.
          </Text>
          <Text style={styles.muted}>Please include statement #{statement.number} with your payment. Disposal is billed at landfill cost.</Text>
        </View>
      </Page>
    </Document>
  );
}
