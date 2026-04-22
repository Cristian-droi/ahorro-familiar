import nodemailer from 'nodemailer';

// Transport + envoltorio para mandar correos a través de la cuenta Gmail
// configurada en .env. Si faltan las variables, las funciones devuelven un
// resultado informativo en vez de lanzar, para que los endpoints puedan
// decidir si avisan como warning o fallan duro.

export type MailResult =
  | { ok: true }
  | { ok: false; reason: 'missing_env' }
  | { ok: false; reason: 'transport_error'; error: unknown };

function hasMailCredentials(): boolean {
  return Boolean(process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD);
}

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_EMAIL,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<MailResult> {
  if (!hasMailCredentials()) {
    return { ok: false, reason: 'missing_env' };
  }
  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from: `"Ahorro Familiar" <${process.env.GMAIL_EMAIL}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'transport_error', error };
  }
}
