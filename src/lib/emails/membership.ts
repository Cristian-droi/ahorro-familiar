// Plantillas HTML y asuntos para los correos de solicitudes de ingreso.
// Diseño alineado con el de la app (verde bosque, bordes redondeados, tipografía sans).

const APPROVAL_SUBJECT = '¡Tu solicitud ha sido aprobada! - Activa tu cuenta';
const REJECTION_SUBJECT = 'Respuesta a tu solicitud de ingreso - Ahorro Familiar';
const PASSWORD_RESET_SUBJECT = 'Restablece tu contraseña - Ahorro Familiar';

export const membershipEmailSubjects = {
  approval: APPROVAL_SUBJECT,
  rejection: REJECTION_SUBJECT,
  passwordReset: PASSWORD_RESET_SUBJECT,
};

export function buildApprovalEmail({
  firstName,
  actionLink,
}: {
  firstName: string;
  actionLink: string;
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #f0fdf4; padding: 24px; text-align: center;">
        <h1 style="color: #16a34a; margin: 0; font-size: 24px;">¡Bienvenido a Ahorro Familiar!</h1>
      </div>
      <div style="padding: 32px; background-color: #ffffff;">
        <p style="color: #333333; font-size: 16px; margin-top: 0;">Hola <strong>${firstName}</strong>,</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.5;">
          ¡Tenemos excelentes noticias! Nuestro comité administrativo ha revisado exitosamente tu solicitud. Has sido <strong>aprobado(a)</strong> de manera oficial como miembro de la junta y tienes vía libre al portal web.
        </p>
        <div style="background-color: #f8fafc; border-left: 4px solid #16a34a; padding: 16px; margin: 24px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #475569; text-transform: uppercase; font-weight: bold;">ACTIVACIÓN DE CUENTA:</p>
          <p style="margin: 12px 0 4px 0; font-size: 15px; color: #1e293b;">Para ingresar por primera vez a la plataforma, debes configurar tu propia contraseña web, haciendo clic en el siguiente enlace confidencial y único.</p>
        </div>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${actionLink}" style="background-color: #16a34a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Activar cuenta y Crear Contraseña</a>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 24px; text-align: center;">
          Una vez finalices, siempre podrás iniciar sesión en el portal usando únicamente tu <strong>Número de Documento</strong>.
        </p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; color: #94a3b8; font-size: 12px;">© ${new Date().getFullYear()} Ahorro Familiar. Todos los derechos reservados.</p>
      </div>
    </div>
  `;
}

export function buildPasswordResetEmail({
  firstName,
  actionLink,
}: {
  firstName: string;
  actionLink: string;
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #f0fdf4; padding: 24px; text-align: center;">
        <h1 style="color: #16a34a; margin: 0; font-size: 24px;">Restablece tu contraseña</h1>
      </div>
      <div style="padding: 32px; background-color: #ffffff;">
        <p style="color: #333333; font-size: 16px; margin-top: 0;">Hola <strong>${firstName}</strong>,</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.5;">
          Recibimos una solicitud para restablecer tu contraseña en Ahorro Familiar. Puedes crear una nueva contraseña haciendo clic en el siguiente enlace. Es personal, de un solo uso y expira en 1 hora.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${actionLink}" style="background-color: #16a34a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Crear nueva contraseña</a>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 0;">
          Si tú no pediste este cambio, puedes ignorar este correo con total tranquilidad; tu contraseña actual seguirá funcionando.
        </p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; color: #94a3b8; font-size: 12px;">© ${new Date().getFullYear()} Ahorro Familiar. Todos los derechos reservados.</p>
      </div>
    </div>
  `;
}

export function buildRejectionEmail({
  firstName,
  reason,
}: {
  firstName: string;
  reason: string;
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-w: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #fce8e8; padding: 24px; text-align: center;">
        <h1 style="color: #ba1a1a; margin: 0; font-size: 24px;">Actualización de Solicitud</h1>
      </div>
      <div style="padding: 32px; background-color: #ffffff;">
        <p style="color: #333333; font-size: 16px; margin-top: 0;">Hola <strong>${firstName}</strong>,</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.5;">
          Gracias por tu interés en formar parte de Ahorro Familiar. Hemos revisado cuidadosamente tu solicitud de ingreso.
        </p>
        <p style="color: #333333; font-size: 16px; line-height: 1.5;">
          Lamentablemente, en esta ocasión <strong>no hemos podido aprobar tu perfil</strong> para formar parte del grupo.
        </p>
        <div style="background-color: #f8fafc; border-left: 4px solid #ba1a1a; padding: 16px; margin: 24px 0; border-radius: 4px;">
          <p style="margin: 0; font-size: 14px; color: #475569; text-transform: uppercase; font-weight: bold;">Motivo del comité:</p>
          <p style="margin: 8px 0 0 0; font-size: 16px; color: #1e293b; font-style: italic;">"${reason}"</p>
        </div>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 0;">
          Agradecemos tu tiempo. Si consideras que se trata de un error o tu situación cambia, podrás postularte nuevamente en el futuro.
        </p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; color: #94a3b8; font-size: 12px;">© ${new Date().getFullYear()} Ahorro Familiar. Todos los derechos reservados.</p>
      </div>
    </div>
  `;
}
