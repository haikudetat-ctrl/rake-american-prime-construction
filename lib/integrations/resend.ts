import "server-only";

export class EmailProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProviderError";
  }
}

export type EmailAttachment = { filename: string; content: Buffer };

/** Minimal Resend client (https://resend.com/docs/api-reference/emails/send-email). */
export async function sendEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        reply_to: input.replyTo ?? undefined,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new EmailProviderError("Resend could not be reached");
  }
  const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok || !body?.id) throw new EmailProviderError(body?.message ?? `Resend ${response.status}`);
  return { id: body.id };
}
