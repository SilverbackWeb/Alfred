import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function sendSlackMessage(channel: string, text: string) {
  if (!process.env.SLACK_BOT_TOKEN) return { error: "Missing SLACK_BOT_TOKEN" };
  try {
    const result = await slack.chat.postMessage({ channel, text });
    return { ok: true, ts: result.ts, channel: result.channel };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

export async function listSlackChannels() {
  if (!process.env.SLACK_BOT_TOKEN) return { error: "Missing SLACK_BOT_TOKEN" };
  try {
    const result = await slack.conversations.list({ types: "public_channel,private_channel", limit: 50 });
    return (result.channels || []).map((c: { id?: string; name?: string }) => ({ id: c.id, name: c.name }));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}
