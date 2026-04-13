/**
 * Branded email wrapper for CRM quote emails.
 * Wraps raw body HTML in a fully styled, responsive email template.
 */

const TENANT_CONFIG = {
  hiphot: {
    name: "HipHot",
    logoUrl:
      "https://hiphot.nl/wp-content/uploads/2022/03/HipHot-logo-300x75-1.png",
    logoAlt: "HipHot",
    logoHeight: 38,
    headerBg: "#ffffff",
    headerTextColor: "#0d0d0d",
    accentColor: "#FFD500",
    phone: "+31 085-505 56 64",
    email: "hallo@hiphot.nl",
    website: "hiphot.nl",
    websiteUrl: "https://hiphot.nl",
  },
  "48-7": {
    name: "48-7 AI Professionals",
    logoUrl:
      "https://base44.app/api/apps/695a3d411fa079edce588856/files/public/695a3d411fa079edce588856/20187d6c3_48-7-AI-professionals-16-1-20264.png",
    logoAlt: "48-7 AI Professionals",
    logoHeight: 38,
    headerBg: "#0d0d0d",
    headerTextColor: "#ffffff",
    accentColor: "#FAB868",
    phone: "+31 085-06 01 487",
    email: "dion@48-7.nl",
    website: "48-7.nl",
    websiteUrl: "https://48-7.nl",
  },
};

/**
 * Wraps body HTML in a branded email template.
 * @param {string} bodyHtml - The raw email body HTML (p tags, etc.)
 * @param {object} options
 * @param {string} options.tenant - "hiphot" or "48-7"
 * @returns {string} Full HTML email document
 */
export function wrapEmailHtml(bodyHtml, { tenant }) {
  const config = TENANT_CONFIG[tenant] || TENANT_CONFIG["48-7"];

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${config.name}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    body, table, td, p, a, li { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; }
    p { margin: 0 0 16px 0; }
    a { color: ${config.accentColor}; }
    @media only screen and (max-width: 640px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-body { padding: 24px 20px !important; }
      .email-footer { padding: 20px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Email container -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td align="center" style="background-color:${config.headerBg}; padding:28px 36px;">
              <img src="${config.logoUrl}" alt="${config.logoAlt}" height="${config.logoHeight}" style="display:block; height:${config.logoHeight}px; width:auto;">
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-body" style="padding:36px 40px; color:#1a1a1a; font-size:15px; line-height:1.7;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="border-top:1px solid #e5e7eb;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="email-footer" style="padding:24px 40px 32px; color:#9ca3af; font-size:12px; line-height:1.6;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="color:#6b7280; font-size:13px; font-weight:600;">
                    ${config.name}
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:6px; color:#9ca3af; font-size:12px;">
                    ${config.phone}&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="mailto:${config.email}" style="color:#9ca3af; text-decoration:none;">${config.email}</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${config.websiteUrl}" style="color:#9ca3af; text-decoration:none;">${config.website}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Email container -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}
