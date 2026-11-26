import nodemailer from "nodemailer";

export async function sendMail(to: string, subject: string, body: string) {
  if (!process.env.SMTP_URL) {
    if (process.env.NODE_ENV !== "production") {
      console.info("Development mail:", to, subject, body);
      return;
    }
    throw new Error("SMTP delivery is unavailable");
  }
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: process.env.MAIL_FROM || "BioTrades X <no-reply@example.com>",
    to,
    subject,
    text: body,
  });
}
