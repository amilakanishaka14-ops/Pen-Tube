import { auth, isConfigured } from "../firebase/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getAdminStats } from "./api.js";
import { $, escapeHtml, formatDateTime, showToast } from "./utils.js";

async function loadAdmin(user) {
  if (!user) { location.href = "auth.html"; return; }
  try {
    const data = await getAdminStats();
    $('[data-admin-total-users]').textContent = data.totalUsers ?? "0";
    $('[data-admin-new-users]').textContent = data.newUsers7d ?? "0";
    $('[data-admin-total-generations]').textContent = data.totalGenerations ?? "0";
    $('[data-admin-active-users]').textContent = data.activeUsers24h ?? "0";
    $('[data-admin-thumbnail]').textContent = data.thumbnailGenerations ?? "0";
    $('[data-admin-seo]').textContent = data.seoGenerations ?? "0";
    $('[data-admin-script]').textContent = data.scriptGenerations ?? "0";
    $('[data-admin-recent-count]').textContent = data.recentActivity?.length ?? "0";
    const list = $('[data-admin-activity]');
    list.innerHTML = (data.recentActivity||[]).map(item=>`<div class="activity-row"><strong>${escapeHtml(item.type||"unknown")}</strong><span>${escapeHtml(item.title||"Untitled")}</span><time>${escapeHtml(formatDateTime(item.createdAt))}</time></div>`).join("") || `<div class="activity-empty">No recent activity.</div>`;
  } catch (error) {
    const message = error?.message || "Access denied.";
    document.querySelector("main")?.insertAdjacentHTML("afterbegin", `<div class="glass-panel" style="padding:20px;margin-bottom:18px"><strong>Access Denied</strong><p class="admin-note">${escapeHtml(message)}</p></div>`);
    showToast("Admin access denied.", "error");
  }
}

if (!location.pathname.endsWith("admin.html")) {
  // no-op
} else if (!isConfigured) {
  showToast("Configure Firebase before using the admin console.", "warning");
} else {
  onAuthStateChanged(auth, (user) => loadAdmin(user));
}
