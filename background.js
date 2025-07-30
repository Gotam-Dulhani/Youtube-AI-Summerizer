// Background service worker for YouTube AI Summarizer Pro

console.log('YouTube AI Summarizer Pro: Background script loaded');

// Initialize extension
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('YouTube AI Summarizer Pro installed');
    
    // Set default settings
    chrome.storage.sync.set({
      defaultSummaryType: 'bullet',
      defaultLength: 2,
      autoDetectLanguage: true,
      preferredModel: 'facebook/bart-large-cnn'
    });
  }
});

// Handle tab updates to detect YouTube videos
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('youtube.com/watch')) {
    // Update badge to indicate video detected
    chrome.action.setBadgeText({
      text: '▶',
      tabId: tabId
    });
    chrome.action.setBadgeBackgroundColor({
      color: '#FF0000',
      tabId: tabId
    });
  } else {
    // Clear badge for non-YouTube pages
    chrome.action.setBadgeText({
      text: '',
      tabId: tabId
    });
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'updateBadge':
      handleUpdateBadge(request, sender);
      break;
      
    case 'openPopup':
      chrome.action.openPopup();
      break;
      
    case 'trackEvent':
      console.log('Analytics:', request.event, request.data);
      break;
      
    default:
      console.log('Unknown message action:', request.action);
  }
});

function handleUpdateBadge(request, sender) {
  if (sender.tab && request.videoId) {
    chrome.action.setBadgeText({
      text: '✓',
      tabId: sender.tab.id
    });
    chrome.action.setBadgeBackgroundColor({
      color: '#00AA00',
      tabId: sender.tab.id
    });
  }
}

// Context menu for quick access
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'summarize-video',
    title: 'Summarize this YouTube video',
    contexts: ['page'],
    documentUrlPatterns: ['*://*.youtube.com/watch*']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'summarize-video' && tab.url.includes('youtube.com/watch')) {
    chrome.action.openPopup();
  }
});

// Keep service worker alive
let keepAliveInterval;

function keepAlive() {
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // This keeps the service worker active
    });
  }, 20000); // Every 20 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Start keep alive when extension starts
keepAlive();

// Clean up on suspend
chrome.runtime.onSuspend.addListener(() => {
  stopKeepAlive();
});

// Error handling
chrome.runtime.onStartup.addListener(() => {
  console.log('YouTube AI Summarizer Pro: Extension started');
});

self.addEventListener('error', (event) => {
  console.error('Background script error:', event.error);
});