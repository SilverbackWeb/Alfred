import { google } from "googleapis";

function getOAuthClient() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

function checkToken() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return { error: "Missing GOOGLE_REFRESH_TOKEN — run /api/auth/google to authorize" };
  return null;
}

// ── GMAIL ─────────────────────────────────────────────────────────────────────

function buildRaw(to: string, subject: string, body: string) {
  return Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function draftEmail(to: string, subject: string, body: string) {
  const err = checkToken();
  if (err) return err;
  try {
    const gmail = google.gmail({ version: "v1", auth: getOAuthClient() });
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: buildRaw(to, subject, body) } },
    });
    return {
      success: true,
      draftId: res.data.id,
      link: `https://mail.google.com/mail/u/0/#drafts/${res.data.id}`,
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendEmail(to: string, subject: string, body: string) {
  const err = checkToken();
  if (err) return err;
  try {
    const gmail = google.gmail({ version: "v1", auth: getOAuthClient() });
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: buildRaw(to, subject, body) },
    });
    return { success: true, messageId: res.data.id, confirmation: `Email sent to ${to}` };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function searchEmails(query: string) {
  const err = checkToken();
  if (err) return err;
  try {
    const gmail = google.gmail({ version: "v1", auth: getOAuthClient() });
    const listRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 10 });
    const messages = listRes.data.messages || [];
    if (!messages.length) return [];

    const details = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        });
        const headers = msg.data.payload?.headers || [];
        const get = (name: string) => headers.find((h) => h.name === name)?.value || "";
        return { subject: get("Subject"), from: get("From"), snippet: msg.data.snippet || "", date: get("Date") };
      })
    );
    return details;
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── CALENDAR ──────────────────────────────────────────────────────────────────

export async function getUpcomingEvents(days = 7) {
  const err = checkToken();
  if (err) return err;
  try {
    const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + days);

    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    });

    return (res.data.items || []).map((e) => ({
      title: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      description: e.description || "",
      link: e.htmlLink || "",
    }));
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createCalendarEvent(title: string, start: string, end: string, description?: string) {
  const err = checkToken();
  if (err) return err;
  try {
    const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: title,
        description: description || "",
        start: { dateTime: start },
        end: { dateTime: end },
      },
    });
    return { success: true, eventId: res.data.id, link: res.data.htmlLink };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── GOOGLE DOCS ───────────────────────────────────────────────────────────────

export async function createGoogleDoc(title: string, content: string) {
  const err = checkToken();
  if (err) return err;
  try {
    const auth = getOAuthClient();
    const docs = google.docs({ version: "v1", auth });

    const createRes = await docs.documents.create({ requestBody: { title } });
    const docId = createRes.data.documentId!;

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      },
    });

    return { success: true, docId, link: `https://docs.google.com/document/d/${docId}/edit` };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
