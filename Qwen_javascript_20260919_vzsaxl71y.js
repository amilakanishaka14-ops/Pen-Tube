// app.js
import { 
  auth, db, googleProvider, 
  signInWithPopup, signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, signOut, 
  onAuthStateChanged, collection, addDoc, 
  getDocs, serverTimestamp, ADMIN_UID 
} from './firebase-config.js';

// API Configuration
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY';

// Toast Notification System
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${type === 'success' ? '✓' : '✗'}</span>
      <span class="toast-message">${message}</span>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }, 100);
}

// Copy to Clipboard
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// Download File
function downloadFile(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${filename}`, 'success');
}

// Show Skeleton Loader
function showSkeletonLoader(containerId) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `
      <div class="skeleton-container">
        <div class="relative flex w-64 animate-pulse gap-2 p-4">
          <div class="h-12 w-12 rounded-full bg-slate-400"></div>
          <div class="flex-1">
            <div class="mb-1 h-5 w-3/5 rounded-lg bg-slate-400 text-lg"></div>
            <div class="h-5 w-[90%] rounded-lg bg-slate-400 text-sm"></div>
          </div>
          <div class="absolute bottom-5 right-0 h-4 w-4 rounded-full bg-slate-400"></div>
        </div>
      </div>
    `;
  }
}

// Hide Skeleton Loader
function hideSkeletonLoader(containerId) {
  const container = document.getElementById(containerId);
  if (container) {
    const skeleton = container.querySelector('.skeleton-container');
    if (skeleton) skeleton.remove();
  }
}

// API: Generate Thumbnail Prompt (Gemini 1.5 Flash)
async function generateThumbnailPrompt(videoTitle) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Generate a highly detailed Midjourney v6 prompt for a viral YouTube thumbnail about "${videoTitle}". Include style, lighting, composition, color palette, and emotional impact. Format: /imagine prompt: [detailed description] --ar 16:9 --v 6`
        }]
      }]
    })
  });
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// API: Get YouTube Trending Keywords (YouTube Data API v3)
async function getYouTubeKeywords(topic) {
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(topic)}&type=video&order=viewCount&maxResults=10&key=${YOUTUBE_API_KEY}`);
    const data = await response.json();
    const keywords = data.items.map(item => item.snippet.title).join(', ');
    
    // Generate SEO tags
    const tagsResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Based on "${topic}" and trending videos: ${keywords}, generate 20 viral YouTube SEO tags and 5 title suggestions. Format: Tags: [tag1, tag2, ...] Titles: [title1, title2, ...]`
          }]
        }]
      })
    });
    const tagsData = await tagsResponse.json();
    return tagsData.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('YouTube API Error:', error);
    return 'Error fetching keywords. Please try again.';
  }
}

// API: Generate Script Outline (Gemini 1.5 Flash)
async function generateScriptOutline(videoTitle) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Create a viral YouTube script outline for "${videoTitle}". Include: 
          1. Hook (first 5 seconds - attention grabber)
          2. Intro (15 seconds - what viewer will learn)
          3. Main Body (3-5 key points with examples)
          4. Call to Action (subscribe, like, comment)
          5. Outro (teaser for next video)
          Make it engaging, conversational, and optimized for 10+ minute watch time. Include estimated timestamps.`
        }]
      }]
    })
  });
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// API: Generate Thumbnail Image (Pollinations.ai - Free, No Key)
async function generateThumbnailImage(prompt) {
  const cleanPrompt = prompt.replace('/imagine prompt:', '').trim();
  const encodedPrompt = encodeURIComponent(cleanPrompt);
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&nologo=true&seed=${Date.now()}`;
}

// Main Generate Function
async function handleGenerate() {
  const videoTitle = document.getElementById('videoTitle').value.trim();
  if (!videoTitle) {
    showToast('Please enter a video title!', 'error');
    return;
  }

  // Show skeleton loaders
  showSkeletonLoader('thumbnailPromptOutput');
  showSkeletonLoader('keywordsOutput');
  showSkeletonLoader('scriptOutput');

  try {
    // Parallel API calls
    const [thumbnailPrompt, keywords, scriptOutline] = await Promise.all([
      generateThumbnailPrompt(videoTitle),
      getYouTubeKeywords(videoTitle),
      generateScriptOutline(videoTitle)
    ]);

    // Hide loaders and show results
    hideSkeletonLoader('thumbnailPromptOutput');
    hideSkeletonLoader('keywordsOutput');
    hideSkeletonLoader('scriptOutput');

    document.getElementById('thumbnailPromptOutput').innerHTML = `
      <div class="output-content">
        <pre>${thumbnailPrompt}</pre>
        <div class="output-actions">
          <button class="btn-action" onclick="copyToClipboard(\`${thumbnailPrompt.replace(/`/g, '\\`')}\`)">
            📋 Copy
          </button>
          <button class="btn-action download-btn" onclick="downloadFile(\`${thumbnailPrompt.replace(/`/g, '\\`')}\`, 'thumbnail-prompt.txt')">
            <span class="button__text">Download</span>
            <span class="button__icon">
              <svg class="svg" viewBox="0 0 35 35" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.5,22.131a1.249,1.249,0,0,1-1.25-1.25V2.187a1.25,1.25,0,0,1,2.5,0V20.881A1.25,1.25,0,0,1,17.5,22.131Z"></path>
                <path d="M17.5,22.693a3.189,3.189,0,0,1-2.262-.936L8.487,15.006a1.249,1.249,0,0,1,1.767-1.767l6.751,6.751a.7.7,0,0,0,.99,0l6.751-6.751a1.25,1.25,0,0,1,1.768,1.767l-6.752,6.751A3.191,3.191,0,0,1,17.5,22.693Z"></path>
                <path d="M31.436,34.063H3.564A3.318,3.318,0,0,1,.25,30.749V22.011a1.25,1.25,0,0,1,2.5,0v8.738a.815.815,0,0,0,.814.814H31.436a.815.815,0,0,0,.814-.814V22.011a1.25,1.25,0,1,1,2.5,0v8.738A3.318,3.318,0,0,1,31.436,34.063Z"></path>
              </svg>
            </span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('keywordsOutput').innerHTML = `
      <div class="output-content">
        <pre>${keywords}</pre>
        <div class="output-actions">
          <button class="btn-action" onclick="copyToClipboard(\`${keywords.replace(/`/g, '\\`')}\`)">
            📋 Copy
          </button>
          <button class="btn-action download-btn" onclick="downloadFile(\`${keywords.replace(/`/g, '\\`')}\`, 'seo-keywords.txt')">
            <span class="button__text">Download</span>
            <span class="button__icon">
              <svg class="svg" viewBox="0 0 35 35" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.5,22.131a1.249,1.249,0,0,1-1.25-1.25V2.187a1.25,1.25,0,0,1,2.5,0V20.881A1.25,1.25,0,0,1,17.5,22.131Z"></path>
                <path d="M17.5,22.693a3.189,3.189,0,0,1-2.262-.936L8.487,15.006a1.249,1.249,0,0,1,1.767-1.767l6.751,6.751a.7.7,0,0,0,.99,0l6.751-6.751a1.25,1.25,0,0,1,1.768,1.767l-6.752,6.751A3.191,3.191,0,0,1,17.5,22.693Z"></path>
                <path d="M31.436,34.063H3.564A3.318,3.318,0,0,1,.25,30.749V22.011a1.25,1.25,0,0,1,2.5,0v8.738a.815.815,0,0,0,.814.814H31.436a.815.815,0,0,0,.814-.814V22.011a1.25,1.25,0,1,1,2.5,0v8.738A3.318,3.318,0,0,1,31.436,34.063Z"></path>
              </svg>
            </span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('scriptOutput').innerHTML = `
      <div class="output-content">
        <pre>${scriptOutline}</pre>
        <div class="output-actions">
          <button class="btn-action" onclick="copyToClipboard(\`${scriptOutline.replace(/`/g, '\\`')}\`)">
            📋 Copy
          </button>
          <button class="btn-action download-btn" onclick="downloadFile(\`${scriptOutline.replace(/`/g, '\\`')}\`, 'script-outline.txt')">
            <span class="button__text">Download</span>
            <span class="button__icon">
              <svg class="svg" viewBox="0 0 35 35" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.5,22.131a1.249,1.249,0,0,1-1.25-1.25V2.187a1.25,1.25,0,0,1,2.5,0V20.881A1.25,1.25,0,0,1,17.5,22.131Z"></path>
                <path d="M17.5,22.693a3.189,3.189,0,0,1-2.262-.936L8.487,15.006a1.249,1.249,0,0,1,1.767-1.767l6.751,6.751a.7.7,0,0,0,.99,0l6.751-6.751a1.25,1.25,0,0,1,1.768,1.767l-6.752,6.751A3.191,3.191,0,0,1,17.5,22.693Z"></path>
                <path d="M31.436,34.063H3.564A3.318,3.318,0,0,1,.25,30.749V22.011a1.25,1.25,0,0,1,2.5,0v8.738a.815.815,0,0,0,.814.814H31.436a.815.815,0,0,0,.814-.814V22.011a1.25,1.25,0,1,1,2.5,0v8.738A3.318,3.318,0,0,1,31.436,34.063Z"></path>
              </svg>
            </span>
          </button>
        </div>
      </div>
    `;

    // Generate thumbnail preview
    const thumbnailUrl = await generateThumbnailImage(thumbnailPrompt);
    document.getElementById('thumbnailPreview').innerHTML = `
      <img src="${thumbnailUrl}" alt="Thumbnail Preview" class="thumbnail-img" />
      <button class="btn-action" onclick="downloadFile('${thumbnailUrl}', 'thumbnail-preview.png', 'image/png')">
        📥 Download Image
      </button>
    `;

    // Save to Firestore
    const user = auth.currentUser;
    if (user) {
      await addDoc(collection(db, 'users', user.uid, 'creator_vault'), {
        videoTitle,
        thumbnailPrompt,
        keywords,
        scriptOutline,
        thumbnailUrl,
        createdAt: serverTimestamp()
      });
      showToast('Saved to Creator Vault!', 'success');
    }

    showToast('Generation complete!', 'success');

  } catch (error) {
    console.error('Generation Error:', error);
    hideSkeletonLoader('thumbnailPromptOutput');
    hideSkeletonLoader('keywordsOutput');
    hideSkeletonLoader('scriptOutput');
    showToast('Error generating content. Please try again.', 'error');
  }
}

// Authentication Functions
async function handleGoogleSignIn() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    showToast(`Welcome ${result.user.displayName}!`, 'success');
    window.location.href = 'app.html';
  } catch (error) {
    console.error('Google Sign In Error:', error);
    showToast('Sign in failed. Please try again.', 'error');
  }
}

async function handleEmailSignIn(email, password, isSignUp = false) {
  try {
    if (isSignUp) {
      await createUserWithEmailAndPassword(auth, email, password);
      showToast('Account created successfully!', 'success');
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast('Signed in successfully!', 'success');
    }
    window.location.href = 'app.html';
  } catch (error) {
    console.error('Email Auth Error:', error);
    showToast(error.message, 'error');
  }
}

async function handleSignOut() {
  try {
    await signOut(auth);
    showToast('Signed out successfully!', 'success');
    window.location.href = 'index.html';
  } catch (error) {
    console.error('Sign Out Error:', error);
    showToast('Sign out failed.', 'error');
  }
}

// Auth State Observer
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log('User signed in:', user.uid);
    updateUIForAuth(true, user);
  } else {
    console.log('User signed out');
    updateUIForAuth(false);
  }
});

function updateUIForAuth(isLoggedIn, user = null) {
  const authButtons = document.getElementById('authButtons');
  const userInfo = document.getElementById('userInfo');
  
  if (authButtons && userInfo) {
    if (isLoggedIn && user) {
      authButtons.style.display = 'none';
      userInfo.style.display = 'flex';
      userInfo.innerHTML = `
        <span class="user-name">${user.displayName || user.email}</span>
        <button class="btn-logout" onclick="handleSignOut()">Sign Out</button>
      `;
      
      // Check if admin
      if (user.uid === ADMIN_UID) {
        const adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.className = 'admin-link';
        adminLink.textContent = '🛡️ Admin Panel';
        userInfo.appendChild(adminLink);
      }
    } else {
      authButtons.style.display = 'flex';
      userInfo.style.display = 'none';
    }
  }
}

// Dashboard: Load Creator Vault
async function loadCreatorVault() {
  const user = auth.currentUser;
  if (!user) {
    showToast('Please sign in to view your vault.', 'error');
    window.location.href = 'auth.html';
    return;
  }

  const vaultContainer = document.getElementById('vaultContainer');
  if (!vaultContainer) return;

  try {
    const querySnapshot = await getDocs(collection(db, 'users', user.uid, 'creator_vault'));
    const items = [];
    
    querySnapshot.forEach((doc) => {
      items.push({ id: doc.id, ...doc.data() });
    });

    items.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);

    if (items.length === 0) {
      vaultContainer.innerHTML = `
        <div class="empty-vault">
          <h3>Your Creator Vault is Empty</h3>
          <p>Generate your first content to get started!</p>
          <a href="app.html" class="btn-primary">Go to AI Engine</a>
        </div>
      `;
      return;
    }

    vaultContainer.innerHTML = items.map(item => `
      <div class="vault-card">
        <div class="vault-header">
          <h3>${item.videoTitle}</h3>
          <span class="vault-date">${new Date(item.createdAt?.seconds * 1000).toLocaleDateString()}</span>
        </div>
        <div class="vault-content">
          <div class="vault-section">
            <h4>🎨 Thumbnail Prompt</h4>
            <p class="vault-preview">${item.thumbnailPrompt.substring(0, 100)}...</p>
          </div>
          <div class="vault-section">
            <h4>🔑 SEO Keywords</h4>
            <p class="vault-preview">${item.keywords.substring(0, 100)}...</p>
          </div>
          <div class="vault-section">
            <h4>📝 Script Outline</h4>
            <p class="vault-preview">${item.scriptOutline.substring(0, 100)}...</p>
          </div>
        </div>
        <div class="vault-actions">
          <button class="btn-action" onclick="viewVaultItem('${item.id}')">View Full</button>
          <button class="btn-action" onclick="deleteVaultItem('${item.id}')">Delete</button>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('Load Vault Error:', error);
    showToast('Error loading vault.', 'error');
  }
}

// Admin Dashboard: Load Stats
async function loadAdminStats() {
  const user = auth.currentUser;
  if (!user || user.uid !== ADMIN_UID) {
    showToast('Access denied. Admin only.', 'error');
    window.location.href = 'index.html';
    return;
  }

  const statsContainer = document.getElementById('adminStats');
  if (!statsContainer) return;

  try {
    // Dummy stats for now
    statsContainer.innerHTML = `
      <div class="admin-stats">
        <div class="stat-card">
          <h3>Total Users</h3>
          <p class="stat-number">1,247</p>
          <span class="stat-change">+12% this week</span>
        </div>
        <div class="stat-card">
          <h3>Total Generations</h3>
          <p class="stat-number">8,432</p>
          <span class="stat-change">+23% this week</span>
        </div>
        <div class="stat-card">
          <h3>Active Today</h3>
          <p class="stat-number">342</p>
          <span class="stat-change">+5% vs yesterday</span>
        </div>
        <div class="stat-card">
          <h3>API Calls</h3>
          <p class="stat-number">24,891</p>
          <span class="stat-change">+18% this week</span>
        </div>
      </div>
      <div class="admin-users">
        <h3>Recent Users</h3>
        <table class="users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Joined</th>
              <th>Generations</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>John Doe</td>
              <td>john@example.com</td>
              <td>2024-01-15</td>
              <td>23</td>
              <td><button class="btn-action">View</button></td>
            </tr>
            <tr>
              <td>Jane Smith</td>
              <td>jane@example.com</td>
              <td>2024-01-14</td>
              <td>45</td>
              <td><button class="btn-action">View</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  } catch (error) {
    console.error('Admin Stats Error:', error);
    showToast('Error loading admin stats.', 'error');
  }
}

// Export functions to global scope
window.handleGenerate = handleGenerate;
window.handleGoogleSignIn = handleGoogleSignIn;
window.handleEmailSignIn = handleEmailSignIn;
window.handleSignOut = handleSignOut;
window.copyToClipboard = copyToClipboard;
window.downloadFile = downloadFile;
window.loadCreatorVault = loadCreatorVault;
window.loadAdminStats = loadAdminStats;