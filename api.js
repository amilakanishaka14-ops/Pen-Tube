import { functions, isConfigured } from "../firebase/firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

function assertConfigured() {
  if (!isConfigured) throw new Error("Firebase is not configured. Update firebase/firebase-config.js before using cloud features.");
}

const call = (name, payload = {}) => {
  assertConfigured();
  return httpsCallable(functions, name)(payload);
};

export async function generateAI(tool, input) {
  const result = await call("generateAI", { tool, input });
  return result.data;
}

export async function searchYouTube(query, options = {}) {
  const result = await call("searchYouTube", { query, ...options });
  return result.data;
}

export async function syncUserProfile(profile = {}) {
  const result = await call("syncUserProfile", profile);
  return result.data;
}

export async function getAdminStats() {
  const result = await call("getAdminStats");
  return result.data;
}

export function buildPollinationsUrl(prompt, { width = 1280, height = 720 } = {}) {
  const safePrompt = String(prompt || "").trim().slice(0, 3200);
  const encoded = encodeURIComponent(safePrompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true`;
}
