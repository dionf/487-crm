import * as tls from "node:tls";

export const maxDuration = 30;

export async function GET() {
  const steps = [];
  const imapHost = process.env.LEAD_INBOX_HOST || "mail.48-7.nl";
  const imapUser = process.env.LEAD_INBOX_USER || "leads@48-7.nl";
  const imapPass = process.env.LEAD_INBOX_PASSWORD;
  const imapPort = parseInt(process.env.LEAD_INBOX_PORT || "993");

  steps.push({
    step: "config",
    host: imapHost,
    user: imapUser,
    port: imapPort,
    passLength: imapPass?.length || 0,
  });

  // Test raw TLS connection first
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("TLS connect timeout 10s")), 10000);
      const socket = tls.connect({
        host: imapHost,
        port: imapPort,
        rejectUnauthorized: false,
      }, () => {
        clearTimeout(timeout);
        steps.push({ step: "tls_connected", authorized: socket.authorized });

        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          // After greeting, try LOGIN
          if (data.includes("OK") && !data.includes("LOGIN")) {
            const loginCmd = `a001 LOGIN ${imapUser} ${imapPass}\r\n`;
            socket.write(loginCmd);
          }
          // After LOGIN response
          if (data.includes("a001")) {
            socket.destroy();
            resolve(data.substring(0, 500));
          }
        });
        socket.on("error", (e) => reject(e));
      });
      socket.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });

    // Check if login succeeded or failed
    const loginOk = result.includes("a001 OK");
    const loginFail = result.includes("a001 NO") || result.includes("a001 BAD");
    steps.push({ step: "imap_response", loginOk, loginFail, raw: result.substring(0, 300) });

    return Response.json({ success: loginOk, steps });
  } catch (e) {
    steps.push({ step: "error", message: e.message });
    return Response.json({ success: false, steps }, { status: 500 });
  }
}
