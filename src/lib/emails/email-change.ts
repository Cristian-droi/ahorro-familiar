// Plantilla y asunto para el correo de verificación de cambio de correo
// real del accionista. Coherente con los otros correos (verde bosque).

export const emailChangeSubject =
  'Confirma tu nuevo correo - Ahorro Familiar';

export function buildEmailChangeEmail({
  firstName,
  actionLink,
  newEmail,
}: {
  firstName: string;
  actionLink: string;
  newEmail: string;
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #f0fdf4; padding: 24px; text-align: center;">
        <h1 style="color: #16a34a; margin: 0; font-size: 24px;">Confirma tu nuevo correo</h1>
      </div>
      <div style="padding: 32px; background-color: #ffffff;">
        <p style="color: #333333; font-size: 16px; margin-top: 0;">Hola <strong>${firstName}</strong>,</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.5;">
          Recibimos una solicitud para cambiar el correo de contacto de tu cuenta en Ahorro Familiar a <strong>${newEmail}</strong>.
        </p>
        <div style="background-color: #f8fafc; border-left: 4px solid #16a34a; padding: 16px; margin: 24px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #475569; text-transform: uppercase; font-weight: bold;">Verificación:</p>
          <p style="margin: 12px 0 4px 0; font-size: 15px; color: #1e293b;">Para confirmar que este correo te pertenece y aplicar el cambio, haz clic en el siguiente enlace. Es personal, de un solo uso y expira en 24 horas.</p>
        </div>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${actionLink}" style="background-color: #16a34a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Confirmar nuevo correo</a>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 0;">
          Si tú no pediste este cambio, puedes ignorar este correo con total tranquilidad; tu correo actual seguirá siendo el que recibe todas las notificaciones.
        </p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; color: #94a3b8; font-size: 12px;">© ${new Date().getFullYear()} Ahorro Familiar. Todos los derechos reservados.</p>
      </div>
    </div>
  `;
}
