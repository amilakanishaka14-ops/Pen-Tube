const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const YOUTUBE_API_KEY = defineSecret("YOUTUBE_API_KEY");
const GEMINI_MODEL = "gemini-3.8-flash";
const MAX_GENERATIONS_PER_DAY = 20;

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  return request.auth.uid;
}

function assertObject(value, label = "input") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpsError("invalid-argument", `${label} must be an object.`);
}

function sanitizeString(value, max = 1000) {
  return String(value ?? "").trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

function parseJsonText(text) {
  const raw = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1));
}

function validateResult(tool, result) {
  const required = {
    thumbnail: ["masterPrompt", "negativePrompt", "aspectRatio", "copy", "sections"],
    seo: ["titleIdeas", "primaryKeywords", "secondaryKeywords", "youtubeTags", "descriptionOutline", "hashtags", "searchIntent", "contentAngles"],
    script: ["hook", "intro", "mainBody", "transitions", "outro", "cta"]
  }[tool];
  if (!required) throw new Error("Unknown tool.");
  for (const key of required) if (!(key in result)) throw new Error(`AI response missing field: ${key}`);
  return result;
}

function schemas() {
  return {
    thumbnail: {
      type: "object",
      properties: {
        masterPrompt: { type: "string" },
        negativePrompt: { type: "string" },
        aspectRatio: { type: "string" },
        copy: { type: "string" },
        sections: { type: "object", properties: { subject:{type:"string"}, composition:{type:"string"}, camera:{type:"string"}, lighting:{type:"string"}, environment:{type:"string"}, colorGrading:{type:"string"}, typographyGuidance:{type:"string"}, emotion:{type:"string"}, visualHierarchy:{type:"string"} }, required:["subject","composition","camera","lighting","environment","colorGrading","typographyGuidance","emotion","visualHierarchy"] }
      },
      required: ["masterPrompt","negativePrompt","aspectRatio","copy","sections"]
    },
    seo: {
      type: "object",
      properties: { titleIdeas:{type:"array",items:{type:"string"}}, primaryKeywords:{type:"array",items:{type:"string"}}, secondaryKeywords:{type:"array",items:{type:"string"}}, youtubeTags:{type:"array",items:{type:"string"}}, descriptionOutline:{type:"string"}, hashtags:{type:"array",items:{type:"string"}}, searchIntent:{type:"string"}, contentAngles:{type:"array",items:{type:"string"}} },
      required:["titleIdeas","primaryKeywords","secondaryKeywords","youtubeTags","descriptionOutline","hashtags","searchIntent","contentAngles"]
    },
    script: {
      type: "object",
      properties: { hook:{type:"string"}, intro:{type:"string"}, mainBody:{type:"array",items:{type:"object",properties:{heading:{type:"string"},beats:{type:"string"}},required:["heading","beats"]}}, transitions:{type:"array",items:{type:"string"}}, outro:{type:"string"}, cta:{type:"string"}, duration:{type:"string"} },
      required:["hook","intro","mainBody","transitions","outro","cta"]
    }
  };
}

function buildInstruction(tool) {
  const base = `You are Pen Tube, a professional YouTube creator OS. Return ONLY valid JSON matching the provided schema. Do not include markdown fences. Avoid inventing data that was not supplied. Write for creators, with practical and editable output.`;
  if (tool === "thumbnail") return `${base} Build a structured master thumbnail prompt. Prioritize strong focal hierarchy, readable text guidance, cinematic composition, lighting, environment, subject emotion, and a useful negative prompt. Do not claim guaranteed CTR or virality.`;
  if (tool === "seo") return `${base} Generate multiple title options, keyword clusters, tags, description structure, hashtags, search intent, and content angles. Do not claim an official YouTube trend score or guaranteed ranking.`;
  return `${base} Generate a concise but useful outline with a hook, intro, logically ordered body sections, transitions, outro, and a natural CTA. Do not write a full copyrighted script.`;
}

function buildUserText(tool, input) {
  const clean = Object.fromEntries(Object.entries(input).map(([k,v]) => [k, sanitizeString(v, 500)]));
  return `Tool: ${tool}\nCreator brief:\n${JSON.stringify(clean, null, 2)}`;
}

async function geminiGenerate(tool, input) {
  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) throw new Error("Gemini API key is not configured on the server.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ systemInstruction:{parts:[{text:buildInstruction(tool)}]}, contents:[{role:"user",parts:[{text:buildUserText(tool,input)}]}], generationConfig:{responseMimeType:"application/json",responseJsonSchema:schemas()[tool],temperature:0.8,maxOutputTokens:2500} }), signal: controller.signal });
    if (!response.ok) { const detail = await response.text(); logger.error("Gemini error", { status: response.status, detail: detail.slice(0, 1000) }); if (response.status === 429) throw new HttpsError("resource-exhausted", "AI usage limit reached. Please try again later."); throw new HttpsError("unavailable", "The AI provider is temporarily unavailable."); }
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(part=>part.text||"").join("") || "";
    const result = validateResult(tool, parseJsonText(text));
    return result;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error?.name === "AbortError") throw new HttpsError("deadline-exceeded", "AI request timed out. Please retry.");
    logger.error("Gemini generation failed", { error: String(error) });
    throw new HttpsError("internal", "The AI response could not be processed safely.");
  } finally { clearTimeout(timer); }
}

async function reserveDailyGeneration(uid) {
  const key = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`usage/${uid}_${key}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.data().count || 0) : 0;
    if (count >= MAX_GENERATIONS_PER_DAY) throw new HttpsError("resource-exhausted", `Free daily generation limit reached (${MAX_GENERATIONS_PER_DAY}).`);
    tx.set(ref, { uid, date:key, count:count+1, updatedAt:FieldValue.serverTimestamp() }, { merge:true });
  });
}

exports.generateAI = onCall({ region: "us-central1", secrets: [GEMINI_API_KEY], timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  const uid = requireAuth(request); assertObject(request.data); const tool = sanitizeString(request.data.tool, 30); const input = request.data.input;
  if (!["thumbnail","seo","script"].includes(tool)) throw new HttpsError("invalid-argument", "Unsupported AI tool.");
  assertObject(input);
  await reserveDailyGeneration(uid);
  const result = await geminiGenerate(tool, input);
  return { tool, model: GEMINI_MODEL, result, usageLimit: MAX_GENERATIONS_PER_DAY };
});

exports.searchYouTube = onCall({ region: "us-central1", secrets: [YOUTUBE_API_KEY], timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  requireAuth(request); assertObject(request.data); const queryText = sanitizeString(request.data.query, 120); const maxResults = Math.min(Math.max(Number(request.data.maxResults || 8),1),10);
  if (!queryText) throw new HttpsError("invalid-argument", "Search query is required.");
  const key = queryText.toLowerCase().replace(/[^a-z0-9\s_-]/g, "").trim().replace(/\s+/g," ").slice(0,120);
  const cacheRef = db.doc(`yt_cache/${encodeURIComponent(key)}`); const cached = await cacheRef.get();
  if (cached.exists) { const data = cached.data(); const age = Date.now() - Number(data.cachedAtMs || 0); if (age < 30*60*1000) return { items:data.items || [], cached:true }; }
  const apiKey = YOUTUBE_API_KEY.value();
  if (!apiKey) throw new HttpsError("failed-precondition", "YouTube API key is not configured on the server.");
  const url = new URL("https://www.googleapis.com/youtube/v3/search"); url.searchParams.set("part","snippet"); url.searchParams.set("q",queryText); url.searchParams.set("type","video"); url.searchParams.set("maxResults",String(maxResults)); url.searchParams.set("key",apiKey);
  const response = await fetch(url);
  if (!response.ok) { logger.warn("YouTube request failed", { status: response.status }); if (response.status === 403) throw new HttpsError("resource-exhausted", "YouTube API quota may be exhausted or the key may be restricted."); throw new HttpsError("unavailable", "YouTube research is temporarily unavailable."); }
  const data = await response.json();
  const items = (data.items||[]).map(item=>({ id:item.id?.videoId || "", title:item.snippet?.title || "", channelTitle:item.snippet?.channelTitle || "", publishedAt:item.snippet?.publishedAt || "", description:item.snippet?.description || "" }));
  await cacheRef.set({ items, cachedAtMs:Date.now(), updatedAt:FieldValue.serverTimestamp() });
  return { items, cached:false };
});

exports.syncUserProfile = onCall({ region: "us-central1", timeoutSeconds: 20, memory: "256MiB" }, async (request) => {
  const uid = requireAuth(request); assertObject(request.data); const userRecord = await admin.auth().getUser(uid); const ref = db.doc(`users/${uid}`); const snap = await ref.get();
  const now = FieldValue.serverTimestamp();
  const payload = { displayName:sanitizeString(request.data.displayName || userRecord.displayName || "Creator",80), email:userRecord.email || "", updatedAt:now, lastSeenAt:now };
  if (!snap.exists) payload.createdAt = now;
  await ref.set(payload,{merge:true});
  return { ok:true };
});

exports.getAdminStats = onCall({ region: "us-central1", timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  requireAuth(request);
  if (request.auth.token.admin !== true) throw new HttpsError("permission-denied", "Access Denied");
  const usersRef = db.collection("users"); const vaultRef = db.collectionGroup("creator_vault");
  const now = Date.now(); const sevenDays = Timestamp.fromMillis(now - 7*24*60*60*1000); const oneDay = Timestamp.fromMillis(now - 24*60*60*1000);
  const [totalUsersSnap,newUsersSnap,totalGenSnap,activeSnap,thumbSnap,seoSnap,scriptSnap,recentSnap] = await Promise.all([
    usersRef.count().get(),
    usersRef.where("createdAt", ">=", sevenDays).count().get(),
    vaultRef.count().get(),
    usersRef.where("lastSeenAt", ">=", oneDay).count().get(),
    vaultRef.where("type", "==", "thumbnail").count().get(),
    vaultRef.where("type", "==", "seo").count().get(),
    vaultRef.where("type", "==", "script").count().get(),
    vaultRef.orderBy("createdAt", "desc").limit(20).get()
  ]);
  return { totalUsers:totalUsersSnap.data().count, newUsers7d:newUsersSnap.data().count, totalGenerations:totalGenSnap.data().count, activeUsers24h:activeSnap.data().count, thumbnailGenerations:thumbSnap.data().count, seoGenerations:seoSnap.data().count, scriptGenerations:scriptSnap.data().count, recentActivity:recentSnap.docs.map(doc=>({id:doc.id,type:doc.data().type||"unknown",title:doc.data().title||"Untitled",createdAt:doc.data().createdAt||null})) };
});
