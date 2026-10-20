import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { optionPrice, type ProposalAddon, type ProposalContent, type ProposalOption } from "@/lib/proposals/content";
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
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6, marginTop: 12 },
  photo: { width: "100%", height: 220, objectFit: "cover", marginBottom: 12 },
  options: { flexDirection: "row", gap: 8 },
  option: { flex: 1, borderWidth: 1, borderColor: COLORS.rule, padding: 8 },
  chosen: { borderColor: COLORS.accent, borderWidth: 2 },
  price: { fontSize: 14, fontFamily: "Helvetica-Bold", marginVertical: 4 },
  small: { fontSize: 8, color: COLORS.muted },
  row: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: COLORS.rule, paddingVertical: 3 },
  bold: { fontFamily: "Helvetica-Bold" },
  terms: { fontSize: 8, lineHeight: 1.4 },
  signature: { width: 220, height: 80, objectFit: "contain", borderBottomWidth: 1, borderBottomColor: COLORS.ink },
});

export type ProposalPdfProps = {
  content: ProposalContent;
  brand: { name: string; phone: string | null; email: string | null; address: string | null };
  sentAt: string | null;
  satellite: Buffer | null;
  signed: {
    option: ProposalOption;
    addons: ProposalAddon[];
    totalCents: number;
    signerName: string;
    signatureDataUrl: string | null;
    signedAt: string;
    ip: string | null;
    userAgent: string | null;
    contentHash: string;
  } | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "long" });

export function ProposalDocument({ content, brand, sentAt, satellite, signed }: ProposalPdfProps) {
  return (
    <Document title={`Proposal ${content.number}`} author={brand.name}>
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
            <Text style={styles.title}>{signed ? "SIGNED AGREEMENT" : "ROOFING PROPOSAL"} #{content.number}</Text>
            {sentAt && <Text style={[styles.muted, { textAlign: "right" }]}>{when(sentAt)}</Text>}
          </View>
        </View>
        <View style={styles.stripe} />

        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
        {satellite && <Image src={satellite} style={styles.photo} />}
        <Text style={styles.bold}>{content.customerName}</Text>
        {content.address && <Text>{content.address}</Text>}

        <Text style={styles.h2}>Scope of work</Text>
        {content.scope.map((line) => <Text key={line}>• {line}</Text>)}

        <Text style={styles.h2}>{signed ? "Chosen option" : "Options"}</Text>
        <View style={styles.options}>
          {(signed ? [signed.option] : content.options).map((o) => (
            <View key={o.systemId} style={signed ? [styles.option, styles.chosen] : styles.option}>
              <Text style={styles.small}>{o.tierLabel.toUpperCase()} · {o.brand}</Text>
              <Text style={styles.bold}>{o.name}</Text>
              <Text style={styles.price}>{formatCents(optionPrice(o))}</Text>
              {o.warranty && <Text style={styles.small}>{o.warranty}</Text>}
            </View>
          ))}
        </View>

        {(signed ? signed.addons : content.addons).length > 0 && (
          <>
            <Text style={styles.h2}>{signed ? "Add-ons chosen" : "Optional add-ons"}</Text>
            {(signed ? signed.addons : content.addons).map((a) => (
              <View key={a.addonId} style={styles.row}>
                <Text>{a.name} ({a.qty} {a.unitLabel})</Text>
                <Text>{formatCents(a.priceCents)}</Text>
              </View>
            ))}
          </>
        )}
        {signed && (
          <View style={[styles.row, { borderBottomWidth: 0, marginTop: 6 }]}>
            <Text style={styles.bold}>Total</Text>
            <Text style={styles.bold}>{formatCents(signed.totalCents)}</Text>
          </View>
        )}
      </Page>

      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h2}>Terms</Text>
        <Text style={styles.terms}>{content.terms}</Text>
        {signed && (
          <>
            <Text style={styles.h2}>Signature</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
            {signed.signatureDataUrl && <Image src={signed.signatureDataUrl} style={styles.signature} />}
            <Text>{signed.signerName}</Text>
            <Text style={styles.muted}>{when(signed.signedAt)}</Text>

            <Text style={styles.h2}>Signing record</Text>
            <Text style={styles.small}>Signed electronically by {signed.signerName} on {when(signed.signedAt)}.</Text>
            <Text style={styles.small}>IP address: {signed.ip ?? "unknown"}</Text>
            <Text style={styles.small}>Device: {signed.userAgent ?? "unknown"}</Text>
            <Text style={styles.small}>Proposal fingerprint (SHA-256): {signed.contentHash}</Text>
            <Text style={styles.small}>The signer agreed to sign electronically before signing.</Text>
          </>
        )}
      </Page>
    </Document>
  );
}
