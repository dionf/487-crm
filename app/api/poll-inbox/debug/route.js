import { ImapFlow } from "imapflow";

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
    passSet: !!imapPass,
    passFirst3: imapPass?.substring(0, 3) || "N/A",
  });

  let client;
  try {
    client = new ImapFlow({
      host: imapHost,
      port: imapPort,
      secure: true,
      auth: { user: imapUser, pass: imapPass },
      logger: false,
      tls: { rejectUnauthorized: false },
      connectTimeout: 15000,
    });

    steps.push({ step: "created_client" });

    await client.connect();
    steps.push({ step: "connected" });

    const lock = await client.getMailboxLock("INBOX");
    steps.push({ step: "mailbox_locked", exists: client.mailbox?.exists });

    let unseen = 0;
    for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true })) {
      unseen++;
      steps.push({ step: "unseen_msg", subject: msg.envelope?.subject });
    }
    steps.push({ step: "fetch_done", unseen });

    lock.release();
    await client.logout();
    steps.push({ step: "done" });

    return Response.json({ success: true, steps });
  } catch (e) {
    steps.push({ step: "error", message: e.message, code: e.code, stack: e.stack?.split("\n").slice(0, 5) });
    try { await client?.logout(); } catch {}
    return Response.json({ success: false, steps }, { status: 500 });
  }
}
