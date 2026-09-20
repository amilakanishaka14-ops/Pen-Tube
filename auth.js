import { auth, isConfigured } from "../firebase/firebase-config.js";
import { GoogleAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { $, $$, showToast } from "./utils.js";
import { syncUserProfile } from "./api.js";

const errorMessage = (error) => {
  const code = error?.code || "";
  const map = {
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/email-already-in-use": "That email is already registered.",
    "auth/weak-password": "Choose a stronger password.",
    "auth/popup-closed-by-user": "Google sign-in was closed before completion.",
    "auth/popup-blocked": "Your browser blocked the sign-in popup.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts. Please try again later."
  };
  return map[code] || "Authentication failed. Please try again.";
};

function setupTabs() {
  $$('[data-auth-tab]').forEach((button) => button.addEventListener("click", () => {
    $$('[data-auth-tab]').forEach((item) => item.classList.toggle("active", item === button));
    $$('[data-auth-form]').forEach((form) => form.classList.toggle("active", form.dataset.authForm === button.dataset.authTab));
  }));
}

function redirectIfSignedIn(user) {
  if (user && location.pathname.endsWith("auth.html")) location.href = "dashboard.html";
}

async function login(form) {
  if (!isConfigured) throw new Error("Firebase is not configured yet. Update firebase/firebase-config.js first.");
  const data = Object.fromEntries(new FormData(form).entries());
  const credential = await signInWithEmailAndPassword(auth, String(data.email).trim(), String(data.password));
  await syncUserProfile({ displayName: credential.user.displayName || credential.user.email?.split("@")[0] || "Creator" });
  showToast("Signed in successfully.", "success");
  location.href = "dashboard.html";
}

async function register(form) {
  if (!isConfigured) throw new Error("Firebase is not configured yet. Update firebase/firebase-config.js first.");
  const data = Object.fromEntries(new FormData(form).entries());
  const credential = await createUserWithEmailAndPassword(auth, String(data.email).trim(), String(data.password));
  await updateProfile(credential.user, { displayName: String(data.displayName).trim() });
  await syncUserProfile({ displayName: String(data.displayName).trim() });
  showToast("Account created successfully.", "success");
  location.href = "dashboard.html";
}

async function googleLogin() {
  if (!isConfigured) throw new Error("Firebase is not configured yet. Update firebase/firebase-config.js first.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  await syncUserProfile({ displayName: credential.user.displayName || credential.user.email?.split("@")[0] || "Creator" });
  location.href = "dashboard.html";
}

async function resetPassword() {
  if (!isConfigured) throw new Error("Firebase is not configured yet. Update firebase/firebase-config.js first.");
  const email = window.prompt("Enter the email address for your Pen Tube account:");
  if (!email) return;
  await sendPasswordResetEmail(auth, email.trim());
  showToast("Password reset email sent if the account exists.", "success");
}

async function boot() {
  if (!location.pathname.endsWith("auth.html")) return;
  setupTabs();
  $('[data-auth-form="login"]')?.addEventListener("submit", async (event) => { event.preventDefault(); try { await login(event.currentTarget); } catch (error) { showToast(errorMessage(error) || error.message, "error"); } });
  $('[data-auth-form="register"]')?.addEventListener("submit", async (event) => { event.preventDefault(); try { await register(event.currentTarget); } catch (error) { showToast(errorMessage(error) || error.message, "error"); } });
  $('[data-google-login]')?.addEventListener("click", async () => { try { await googleLogin(); } catch (error) { showToast(errorMessage(error) || error.message, "error"); } });
  $('[data-reset-password]')?.addEventListener("click", async () => { try { await resetPassword(); } catch (error) { showToast(errorMessage(error) || error.message, "error"); } });
  if (isConfigured) onAuthStateChanged(auth, redirectIfSignedIn);
}

boot();
