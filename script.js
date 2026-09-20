import { auth, isConfigured } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { $, $$, copyText, downloadText, escapeHtml, formatDate, formatDateTime, showToast, slugify } from "./utils.js";
import { buildPollinationsUrl, generateAI, searchYouTube } from "./api.js";
import { removeVaultItem, saveVaultItem, subscribeVault } from "./firestore.js";

const state = { user: null, vault: [], unsubscribeVault: null };

function setupNavigation() {
  $('[data-mobile-menu]')?.addEventListener("click", () => $('[data-nav]')?.classList.toggle("open"));
  $('[data-top]')?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
}

function setupAccountLink() {
  const link = $('[data-account-link]');
  const label = $('[data-account-label]');
  if (!link || !label) return;
  if (!isConfigured) { label.textContent = "Configure Firebase"; link.href = "README.md"; return; }
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    label.textContent = user ? (user.displayName || user.email?.split("@")[0] || "Account") : "Sign in";
    link.href = user ? "dashboard.html" : "auth.html";
    if (location.pathname.endsWith("dashboard.html")) bootDashboard(user);
  });
}

function setupTabs() {
  const tabs = $$('[data-tool-tab]');
  if (!tabs.length) return;
  const activate = (name, writeHash = true) => {
    tabs.forEach((tab) => { const active = tab.dataset.toolTab === name; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); });
    $$('[data-tool-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.toolPanel === name));
    if (writeHash) history.replaceState(null, "", `#${name}`);
  };
  tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.dataset.toolTab)));
  const hash = location.hash.replace("#", "");
  if (["thumbnail","seo","script"].includes(hash)) activate(hash, false);
}

function setupDropzones() {
  $$('[data-dropzone]').forEach((zone) => {
    const input = $('[data-image-input]', zone);
    const preview = $('[data-file-preview]', zone);
    const render = (file) => {
      if (!file) return;
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) { showToast("Use JPG, PNG or WEBP up to 5 MB.", "warning"); input.value = ""; return; }
      preview.classList.remove("hidden");
      preview.replaceChildren();
      const img = document.createElement("img"); img.alt = "Reference preview"; img.src = URL.createObjectURL(file); preview.appendChild(img);
      const text = document.createElement("span"); text.textContent = file.name; preview.appendChild(text);
    };
    zone.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
    input?.addEventListener("change", () => render(input.files?.[0]));
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("dragover"); render(e.dataTransfer.files?.[0]); });
  });
}

function collectForm(form) { return Object.fromEntries(new FormData(form).entries()); }

function renderThumbnail(result, card) {
  const sections = result.sections || {};
  card.innerHTML = `<div class="output-body"><div class="output-title"><div><div class="tool-kicker">MASTER THUMBNAIL PROMPT</div><h3>${escapeHtml(result.copy || "Creator-ready thumbnail direction")}</h3></div><span class="output-meta">${escapeHtml(result.aspectRatio || "16:9")}</span></div><div class="result-section"><h4>Master prompt</h4><div class="copy-box">${escapeHtml(result.masterPrompt || "")}</div></div><div class="result-section"><h4>Structured direction</h4><ul>${Object.entries(sections).map(([key,value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul></div><div class="result-section"><h4>Negative prompt</h4><div class="copy-box">${escapeHtml(result.negativePrompt || "")}</div></div><div class="output-actions"><button class="action-button primary" data-copy-output>Copy</button><button class="action-button" data-download-txt>Download TXT</button><button class="action-button" data-download-json>Download JSON</button><button class="action-button" data-preview>Generate Preview</button><button class="action-button" data-save-vault>Save to Vault</button><button class="action-button" data-regenerate>Regenerate</button></div><div class="preview-wrap hidden" data-preview-wrap></div></div>`;
}

function renderSEO(result, card, research = []) {
  const arr = (value) => Array.isArray(value) ? value : [];
  card.innerHTML = `<div class="output-body"><div class="output-title"><div><div class="tool-kicker">SEO & KEYWORDS</div><h3>Creator discovery pack</h3></div><span class="output-meta">AI generated</span></div><div class="result-section"><h4>Title ideas</h4><ol>${arr(result.titleIdeas).map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ol></div><div class="result-section"><h4>Primary keywords</h4><p>${escapeHtml(arr(result.primaryKeywords).join(", "))}</p></div><div class="result-section"><h4>Secondary keywords</h4><p>${escapeHtml(arr(result.secondaryKeywords).join(", "))}</p></div><div class="result-section"><h4>YouTube tags</h4><p>${escapeHtml(arr(result.youtubeTags).join(", "))}</p></div><div class="result-section"><h4>Description outline</h4><div class="copy-box">${escapeHtml(result.descriptionOutline || "")}</div></div><div class="result-section"><h4>Hashtags</h4><p>${escapeHtml(arr(result.hashtags).join(" "))}</p></div><div class="result-section"><h4>Search intent</h4><p>${escapeHtml(result.searchIntent || "")}</p></div><div class="result-section"><h4>Content angles</h4><ul>${arr(result.contentAngles).map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div>${research.length?`<div class="result-section"><h4>YouTube research signals</h4><ul>${research.map(x=>`<li>${escapeHtml(x.title)} <span class="output-meta">— ${escapeHtml(x.channelTitle||"")}</span></li>`).join("")}</ul></div>`:""}<div class="output-actions"><button class="action-button primary" data-copy-output>Copy</button><button class="action-button" data-download-txt>Download TXT</button><button class="action-button" data-download-json>Download JSON</button><button class="action-button" data-save-vault>Save to Vault</button><button class="action-button" data-regenerate>Regenerate</button></div></div>`;
}

function renderScript(result, card) {
  const body = Array.isArray(result.mainBody) ? result.mainBody : [];
  const transitions = Array.isArray(result.transitions) ? result.transitions : [];
  card.innerHTML = `<div class="output-body"><div class="output-title"><div><div class="tool-kicker">SCRIPT OUTLINE</div><h3>Video structure</h3></div><span class="output-meta">${escapeHtml(result.duration || "")}</span></div><div class="result-section"><h4>Hook</h4><div class="copy-box">${escapeHtml(result.hook || "")}</div></div><div class="result-section"><h4>Intro</h4><div class="copy-box">${escapeHtml(result.intro || "")}</div></div><div class="result-section"><h4>Main body</h4><ul>${body.map(x=>`<li><strong>${escapeHtml(x.heading||"Section")}</strong> — ${escapeHtml(x.beats||"")}</li>`).join("")}</ul></div><div class="result-section"><h4>Transitions</h4><ul>${transitions.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div><div class="result-section"><h4>Outro</h4><div class="copy-box">${escapeHtml(result.outro || "")}</div></div><div class="result-section"><h4>CTA</h4><div class="copy-box">${escapeHtml(result.cta || "")}</div></div><div class="output-actions"><button class="action-button primary" data-copy-output>Copy</button><button class="action-button" data-download-txt>Download TXT</button><button class="action-button" data-download-json>Download JSON</button><button class="action-button" data-save-vault>Save to Vault</button><button class="action-button" data-regenerate>Regenerate</button></div></div>`;
}

function flattenResult(tool, result) {
  if (tool === "thumbnail") return `MASTER THUMBNAIL PROMPT\n\n${result.masterPrompt}\n\nCOPY\n${result.copy}\n\nNEGATIVE PROMPT\n${result.negativePrompt}\n\nASPECT RATIO\n${result.aspectRatio}\n\nSTRUCTURED DIRECTION\n${Object.entries(result.sections||{}).map(([k,v])=>`${k}: ${v}`).join("\n")}`;
  if (tool === "seo") return [`TITLE IDEAS`, ...(result.titleIdeas||[]), "", `PRIMARY KEYWORDS`, (result.primaryKeywords||[]).join(", "), "", `SECONDARY KEYWORDS`, (result.secondaryKeywords||[]).join(", "), "", `YOUTUBE TAGS`, (result.youtubeTags||[]).join(", "), "", `DESCRIPTION OUTLINE`, result.descriptionOutline||"", "", `HASHTAGS`, (result.hashtags||[]).join(" "), "", `SEARCH INTENT`, result.searchIntent||"", "", `CONTENT ANGLES`, ...(result.contentAngles||[])].join("\n");
  return [`HOOK`, result.hook||"", "", `INTRO`, result.intro||"", "", `MAIN BODY`, ...(result.mainBody||[]).map(x=>`${x.heading}: ${x.beats}`), "", `TRANSITIONS`, ...(result.transitions||[]), "", `OUTRO`, result.outro||"", "", `CTA`, result.cta||""].join("\n");
}

function setLoading(form, loading) {
  const panel = form.closest("[data-tool-panel]");
  const loader = $("[data-skeleton]", panel); const button = $(".sparkle-button", form);
  loader?.classList.toggle("hidden", !loading); if (button) button.disabled = loading;
}

async function handleGenerate(form, tool) {
  if (!state.user) { showToast("Please sign in first to use the AI engine.", "warning"); return; }
  const input = collectForm(form);
  const card = $(`[data-output="${tool}"]`, form.closest("[data-tool-panel]"));
  const panel = form.closest("[data-tool-panel]");
  const youtubeResearch = state[`research_${tool}`] || [];
  setLoading(form, true); card.classList.add("hidden");
  try {
    const result = await generateAI(tool, input);
    card.classList.remove("hidden");
    if (tool === "thumbnail") renderThumbnail(result, card);
    if (tool === "seo") renderSEO(result, card, youtubeResearch);
    if (tool === "script") renderScript(result, card);
    card.dataset.rawResult = JSON.stringify(result);
    card.dataset.title = tool === "thumbnail" ? (result.copy || "Thumbnail Prompt") : tool === "seo" ? "YouTube SEO & Keywords" : "Script Outline";
    card.dataset.flat = flattenResult(tool, result);
    card.dataset.tool = tool;
    showToast("Generation complete.", "success");
  } catch (error) { card.classList.remove("hidden"); showToast(error?.message || "Something went wrong.", "error"); }
  finally { setLoading(form, false); }
}

function setupGenerators() {
  $$('[data-generator-form]').forEach((form) => form.addEventListener("submit", (event) => { event.preventDefault(); handleGenerate(form, form.dataset.generatorForm); }));
  $('[data-youtube-search]')?.addEventListener("click", async () => {
    const panel = $('[data-tool-panel="seo"]'); const form = $('[data-generator-form="seo"]'); const data = collectForm(form); const q = data.youtubeQuery || data.keyword || data.topic;
    if (!q) return showToast("Enter a topic or keyword first.", "warning");
    const status = $('[data-youtube-status]', panel); const box = $('[data-youtube-results]', panel); status.textContent = "Searching YouTube…";
    try { const result = await searchYouTube(q, { maxResults: 8 }); state.research_seo = result.items || []; box.innerHTML = (result.items||[]).map(item=>`<div class="yt-item"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.channelTitle||"")}</span></div>`).join(""); box.classList.remove("hidden"); status.textContent = result.cached ? "Showing cached YouTube signals." : "Research signals loaded."; } catch (error) { status.textContent = "YouTube research is unavailable right now."; showToast(error?.message || "YouTube search failed.", "warning"); }
  });
}

function resultPayload(card) { return { tool: card.dataset.tool, title: card.dataset.title, raw: JSON.parse(card.dataset.rawResult||"{}"), flat: card.dataset.flat||"" }; }

function setupOutputActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-output],[data-download-txt],[data-download-json],[data-save-vault],[data-regenerate],[data-preview]"); if (!button) return;
    const card = button.closest(".output-card"); if (!card) return; const payload = resultPayload(card);
    try {
      if (button.hasAttribute("data-copy-output")) { await copyText(payload.flat); showToast("Copied to clipboard.", "success"); }
      if (button.hasAttribute("data-download-txt")) { downloadText(`PenTube_${slugify(payload.title)}.txt`, payload.flat); showToast("TXT export started.", "success"); }
      if (button.hasAttribute("data-download-json")) { downloadText(`PenTube_${slugify(payload.title)}.json`, JSON.stringify(payload.raw,null,2), "application/json"); showToast("JSON export started.", "success"); }
      if (button.hasAttribute("data-save-vault")) { if (!state.user) return showToast("Please sign in first.", "warning"); await saveVaultItem(state.user, { type: payload.tool, title: payload.title, prompt: payload.tool === "thumbnail" ? payload.raw.masterPrompt : payload.tool === "seo" ? JSON.stringify(payload.raw) : payload.raw.hook || "", output: payload.flat }); showToast("Saved to Creator Vault.", "success"); }
      if (button.hasAttribute("data-regenerate")) { const form = $(`[data-generator-form="${payload.tool}"]`); if (form) await handleGenerate(form,payload.tool); }
      if (button.hasAttribute("data-preview")) { const wrap = $('[data-preview-wrap]', card); wrap.classList.remove("hidden"); wrap.innerHTML = `<div class="result-section"><h4>AI Preview</h4><img loading="lazy" alt="AI thumbnail preview" style="width:100%;border-radius:14px;border:1px solid rgba(255,255,255,.08)" src="${buildPollinationsUrl(payload.raw.masterPrompt || payload.flat)}"><p class="output-meta">Preview service may be temporarily unavailable. It is separate from Gemini generation.</p></div>`; }
    } catch (error) { showToast(error?.message || "Action failed. Please try again.", "error"); }
  });
}

function bootDashboard(user) {
  if (!location.pathname.endsWith("dashboard.html")) return;
  if (!user) { location.href = "auth.html"; return; }
  $('[data-profile-name]').textContent = user.displayName || "Creator";
  $('[data-profile-email]').textContent = user.email || "—";
  $('[data-avatar]').textContent = (user.displayName || user.email || "PT").slice(0,2).toUpperCase();
  $('[data-profile-created]').textContent = formatDate(user.metadata?.creationTime);
  state.unsubscribeVault?.();
  state.unsubscribeVault = subscribeVault(user, (items, error) => {
    if (error) return showToast("Unable to load Creator Vault.", "error");
    state.vault = items; renderVault(items);
  });
}

function renderVault(items) {
  const grid = $('[data-vault-grid]'); if (!grid) return;
  const counts = { total:items.length, thumbnail:0, seo:0, script:0 }; items.forEach(item=>{ if (item.type in counts) counts[item.type]++; });
  $('[data-vault-count]').textContent = String(items.length); $('[data-stat-total]').textContent = String(counts.total); $('[data-stat-thumbnail]').textContent = String(counts.thumbnail); $('[data-stat-seo]').textContent = String(counts.seo); $('[data-stat-script]').textContent = String(counts.script);
  if (!items.length) { grid.innerHTML = `<div class="vault-empty"><div class="empty-icon">⬡</div><h3>No saved items yet</h3><p>Generate something in the AI Engine and choose “Save to Vault”.</p></div>`; return; }
  grid.innerHTML = items.map(item=>`<article class="vault-item"><div class="vault-item-head"><span class="vault-type">${escapeHtml(item.type)}</span><span class="vault-date">${escapeHtml(formatDateTime(item.createdAt))}</span></div><h3>${escapeHtml(item.title||"Untitled")}</h3><div class="vault-preview">${escapeHtml(item.output||"")}</div><div class="vault-item-actions"><button class="action-button primary" data-vault-download data-id="${item.id}">Download</button><button class="action-button" data-vault-copy data-id="${item.id}">Copy</button><button class="action-button" data-vault-delete data-id="${item.id}">Delete</button></div></article>`).join("");
}

function setupVaultActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-vault-download],[data-vault-copy],[data-vault-delete]"); if (!button) return;
    const item = state.vault.find(x=>x.id===button.dataset.id); if (!item) return;
    try { if (button.hasAttribute("data-vault-download")) downloadText(`PenTube_${slugify(item.title||item.type)}.txt`, item.output||""); if (button.hasAttribute("data-vault-copy")) { await copyText(item.output||""); showToast("Copied to clipboard.","success"); } if (button.hasAttribute("data-vault-delete")) { if (!window.confirm("Delete this saved item?")) return; await removeVaultItem(state.user,item.id); showToast("Vault item deleted.","success"); } } catch (error) { showToast(error?.message||"Vault action failed.","error"); }
  });
  $('[data-export-vault]')?.addEventListener("click", () => { if (!state.vault.length) return showToast("Your vault is empty.","warning"); downloadText("PenTube_Creator_Vault.json", JSON.stringify(state.vault,null,2), "application/json"); showToast("Vault export started.","success"); });
}

function boot() {
  setupNavigation(); setupAccountLink(); setupTabs(); setupDropzones(); setupGenerators(); setupOutputActions(); setupVaultActions();
  if (location.pathname.endsWith("app.html") && !isConfigured) showToast("Configure Firebase before using cloud AI features.", "warning");
}

boot();
