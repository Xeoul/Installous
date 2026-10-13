// Phone notifications. Each one is logged to notifications.json beside the
// bots' state (on the fund-data branch), where a daily Claude routine picks
// up the day's messages and pushes them to the owner's phone. If NTFY_TOPIC
// is set it is also sent straight away through ntfy (https://ntfy.sh).
import { readFile, writeFile } from "fs/promises";
import path from "path";
import type { Notification } from "../src/lib/notifications";

const SITE = "https://xeoul.github.io/Installous";
const KEEP = 60;

export async function notify(n: Notification): Promise<void> {
  console.log(`Notify: ${n.title}\n  ${n.message.replace(/\n/g, "\n  ")}`);
  await record(n);
  const topic = process.env.NTFY_TOPIC;
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

/** Keep the latest notifications, newest first, with the New York date and time they went out. */
async function record(n: Notification) {
  const file = path.join(process.env.FUND_DIR ?? path.join("data", "fund"), "notifications.json");
  let log: unknown[] = [];
  try {
    log = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // first notification
  }
  const now = new Date();
  const at = now.toLocaleString("sv-SE", { timeZone: "America/New_York" }).slice(0, 16);
  const entry = { date: at.slice(0, 10), at, title: n.title, message: n.message, link: SITE + n.path };
  await writeFile(file, JSON.stringify([entry, ...log].slice(0, KEEP), null, 2) + "\n");
}
