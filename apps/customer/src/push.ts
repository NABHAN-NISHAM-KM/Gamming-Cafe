import { api } from "./api";

/**
 * Web push: "10 minutes left", "your food is ready", booking reminders, new
 * inbox messages. Needs a service worker and the browser's permission; the
 * Android app's web view has no web push, so it reports "unsupported".
 */
export type PushState = "unsupported" | "denied" | "on" | "off";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && location.protocol !== "capacitor:";

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js");
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

const toKey = (b64: string) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function enablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const { publicKey } = await api<{ publicKey: string | null }>("/push/key");
  if (!publicKey) return "unsupported"; // the venue hasn't set up notifications
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  const json = sub.toJSON();
  await api("/push/subscribe", { method: "POST", body: { subscription: { endpoint: json.endpoint, keys: json.keys } } });
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  if (sub) {
    await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}
