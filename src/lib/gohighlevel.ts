const GHL_BASE = "https://rest.gohighlevel.com/v1";

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function checkCredentials() {
  if (!process.env.GHL_API_KEY) return { error: "Missing GHL_API_KEY" };
  if (!process.env.GHL_LOCATION_ID) return { error: "Missing GHL_LOCATION_ID" };
  return null;
}

// ── CONTACTS ──────────────────────────────────────────────────────────────────

export async function searchContacts(query: string) {
  const err = checkCredentials();
  if (err) return err;
  try {
    const res = await fetch(
      `${GHL_BASE}/contacts/search?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(query)}`,
      { headers: ghlHeaders() }
    );
    const data = await res.json();
    return (data.contacts || []).map((c: {
      id: string; firstName: string; lastName: string;
      email: string; phone: string; tags: string[];
    }) => ({
      id: c.id,
      name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
      email: c.email,
      phone: c.phone,
      tags: c.tags,
    }));
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createContact(data: {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
}) {
  const err = checkCredentials();
  if (err) return err;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify({ ...data, locationId: process.env.GHL_LOCATION_ID }),
    });
    const result = await res.json();
    return { success: true, contactId: result.contact?.id, name: `${data.firstName} ${data.lastName || ""}`.trim() };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateContact(contactId: string, data: {
  firstName?: string; lastName?: string;
  email?: string; phone?: string; tags?: string[];
}) {
  const err = checkCredentials();
  if (err) return err;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: ghlHeaders(),
      body: JSON.stringify(data),
    });
    const result = await res.json();
    return { success: true, contact: result.contact };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── PIPELINE ──────────────────────────────────────────────────────────────────

export async function getPipelineDeals(pipelineId?: string) {
  const err = checkCredentials();
  if (err) return err;
  try {
    const params = new URLSearchParams({
      locationId: process.env.GHL_LOCATION_ID!,
      ...(pipelineId ? { pipelineId } : {}),
    });
    const res = await fetch(`${GHL_BASE}/opportunities/search?${params}`, { headers: ghlHeaders() });
    const data = await res.json();
    return (data.opportunities || []).map((o: {
      id: string; name: string; status: string;
      monetaryValue: number;
      contact: { name: string };
      pipelineStage: { name: string };
    }) => ({
      id: o.id,
      name: o.name,
      status: o.status,
      value: o.monetaryValue,
      contact: o.contact?.name,
      stage: o.pipelineStage?.name,
    }));
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── MESSAGING ─────────────────────────────────────────────────────────────────

export async function sendSMS(contactId: string, message: string) {
  const err = checkCredentials();
  if (err) return err;
  try {
    const res = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify({ type: "SMS", contactId, message }),
    });
    const result = await res.json();
    return { success: true, messageId: result.messageId || result.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
