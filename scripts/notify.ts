// Send phone notifications through ntfy (https://ntfy.sh): install the ntfy
// app and subscribe to the topic in the NTFY_TOPIC secret. Without the
// secret this only logs what it would have sent.
import type { Notification } from "../src/lib/notifications";

const SITE = "https://xeoul.github.io/Installous";

export async function notify(n: Notification): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  console.log(`Notify: ${n.title}\n  ${n.message.replace(/\n/g, "\n  ")}`);
  if (!topic) return;
  try {
    const res = await fetch(process.env.NTFY_SERVER ?? "https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, title: n.title, message: n.message, tags: n.tags, click: SITE + n.path }),
    });
    if (!res.ok) console.warn(`  ntfy answered ${res.status}: ${await res.text()}`);
  } catch (err) {
    // A failed notification never stops the bot.
    console.warn(`  Couldn't send: ${(err as Error).message}`);
  }
}
