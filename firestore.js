import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db, isConfigured } from "../firebase/firebase-config.js";

export async function saveVaultItem(user, item) {
  if (!isConfigured || !user) throw new Error("Please sign in before saving to Creator Vault.");
  const ref = collection(db, "users", user.uid, "creator_vault");
  const payload = {
    type: String(item.type || "unknown").slice(0, 40),
    title: String(item.title || "Untitled").slice(0, 180),
    prompt: String(item.prompt || "").slice(0, 8000),
    output: String(item.output || "").slice(0, 30000),
    metadata: item.metadata || {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  return addDoc(ref, payload);
}

export function subscribeVault(user, callback) {
  if (!isConfigured || !user) return () => {};
  const ref = collection(db, "users", user.uid, "creator_vault");
  const q = query(ref, orderBy("createdAt", "desc"), limit(60));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))), (error) => callback([], error));
}

export async function removeVaultItem(user, id) {
  if (!user || !id) throw new Error("Missing vault item.");
  return deleteDoc(doc(db, "users", user.uid, "creator_vault", id));
}
