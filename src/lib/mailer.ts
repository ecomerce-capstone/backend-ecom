import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 0);

let transporter: nodemailer.Transporter | null = null;
if (smtpHost && smtpPort) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendMail(to: string, subject: string, html: string) {
  if (!transporter) {
    console.log("SMTP not configured, cannot send email");
    console.log("Subject:", subject);
    console.log("Body:", html);
    return;
  }
  await transporter.sendMail({
    from: process.env.FROM_EMAIL || "no-reply@example.com",
    to,
    subject,
    html,
  });
}
