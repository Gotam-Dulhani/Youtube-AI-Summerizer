// Content script for YouTube AI Summarizer Pro
// Runs on YouTube pages to enhance functionality

(function() {
  'use strict';

  let currentVideoId = null;
  let videoObserver = null;
  let transcriptCache = new Map();

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('YouTube AI Summarizer Pro: Content script loaded');
    
    // Monitor for video changes
    observeVideoChanges();
    
    // Add enhancement button to YouTube UI
    addSummarizerButton();
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener(handleMessage);
    
    // Cache transcript when available
    cacheTranscriptData();
  }

  function observeVideoChanges() {
    // Watch for URL changes (YouTube is a SPA)
    let lastUrl = location.href;
    
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        
        if (location.href.includes('/watch?v=')) {
          const videoId = new URLSearchParams(location.search).get('v');
          if (videoId !== currentVideoId) {
            currentVideoId = videoId;
            onVideoChange(videoId);
          }
        }
      }
    });

    urlObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial check
    if (location.href.includes('/watch?v=')) {
      currentVideoId = new URLSearchParams(location.search).get('v');
      onVideoChange(currentVideoId);
    }
  }

  function onVideoChange(videoId) {
    console.log('Video changed:', videoId);
    
    // Update extension badge
    chrome.runtime.sendMessage({
      action: 'updateBadge',
      videoId: videoId
    });
    
    // Reset transcript cache for new video
    if (!transcriptCache.has(videoId)) {
      setTimeout(() => cacheTranscriptData(), 2000);
    }
    
    // Update summarizer button
    updateSummarizerButton(videoId);
  }

  function addSummarizerButton() {
    // Wait for YouTube's UI to load
    const checkForControls = setInterval(() => {
      const controlsContainer = document.querySelector('#menu-container #top-level-buttons-computed');
      
      if (controlsContainer && !document.getElementById('ai-summarizer-btn')) {
        createSummarizerButton(controlsContainer);
        clearInterval(checkForControls);
      }
    }, 1000);

    // Clear interval after 10 seconds to avoid infinite checking
    setTimeout(() => clearInterval(checkForControls), 10000);
  }

  function createSummarizerButton(container) {
    const button = document.createElement('button');
    button.id = 'ai-summarizer-btn';
    button.className = 'yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m';
    button.innerHTML = `
      <div class="yt-spec-button-shape-next__button-text-content">
        <span style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 16px;">🤖</span>
          <span>AI Summary</span>
        </span>
      </div>
    `;
    
    button.style.cssText = `
      margin-left: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 18px;
      padding: 8px 16px;
      cursor: pointer;
      transition: all 0.3s ease;
      font-family: Roboto, Arial, sans-serif;
      font-size: 14px;
      font-weight: 500;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.transform = 'translateY(-2px)';
      button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = 'none';
    });

    button.addEventListener('click', () => {
      // Open extension popup
      chrome.runtime.sendMessage({ action: 'openPopup' });
    });

    container.appendChild(button);
  }

  function updateSummarizerButton(videoId) {
    const button = document.getElementById('ai-summarizer-btn');
    if (button && transcriptCache.has(videoId)) {
      button.style.background = 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)';
      button.title = 'Transcript cached - Ready for AI summary';
    }
  }

  async function cacheTranscriptData() {
    if (!currentVideoId) return;

    try {
      const transcript = await extractTranscriptFromPage();
      if (transcript) {
        transcriptCache.set(currentVideoId, {
          text: transcript,
          timestamp: Date.now(),
          source: 'page_extraction'
        });
        
        console.log('Transcript cached for video:', currentVideoId);
        updateSummarizerButton(currentVideoId);
      }
    } catch (error) {
      console.log('Could not cache transcript:', error);
    }
  }

  async function extractTranscriptFromPage() {
    // Try to extract transcript from YouTube's UI
    const transcriptButtons = document.querySelectorAll('[aria-label*="transcript" i], [aria-label*="Show transcript" i]');
    
    for (const button of transcriptButtons) {
      try {
        // Click transcript button
        button.click();
        
        // Wait for transcript to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Extract transcript text
        const transcriptContainer = document.querySelector('[target-id="engagement-panel-searchable-transcript"]');
        
        if (transcriptContainer) {
          const transcriptItems = transcriptContainer.querySelectorAll('[data-seq]');
          const transcriptText = Array.from(transcriptItems)
            .map(item => {
              const textElement = item.querySelector('.segment-text');
              return textElement ? textElement.textContent.trim() : '';
            })
            .filter(text => text.length > 0)
            .join(' ');
          
          // Close transcript panel
          const closeButton = transcriptContainer.querySelector('tp-yt-iron-icon[icon="close"]');
          if (closeButton) closeButton.click();
          
          return transcriptText;
        }
      } catch (error) {
        console.log('Transcript extraction attempt failed:', error);
        continue;
      }
    }
    
    return null;
  }

  function handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'getVideoInfo':
        sendResponse(getVideoInfo());
        break;
        
      case 'getTranscript':
        handleGetTranscript(request.videoId, sendResponse);
        return true; // Keep channel open for async response
        
      case 'getCachedTranscript':
        const cached = transcriptCache.get(request.videoId);
        sendResponse({ 
          success: !!cached, 
          data: cached || null 
        });
        break;
        
      default:
        sendResponse({ error: 'Unknown action' });
    }
  }

  function getVideoInfo() {
    const videoId = new URLSearchParams(window.location.search).get('v');
    
    // Enhanced video info extraction
    const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.style-scope.ytd-video-primary-info-renderer, #title h1');
    const channelElement = document.querySelector('#owner-name a, #channel-name a, .ytd-channel-name a');
    const viewsElement = document.querySelector('#info #count yt-view-count-renderer span, .view-count');
    const durationElement = document.querySelector('.ytp-time-duration');
    const descriptionElement = document.querySelector('#description yt-formatted-string, #meta-contents #description');
    
    const title = titleElement ? titleElement.textContent.trim() : 'Unknown Title';
    const channel = channelElement ? channelElement.textContent.trim() : 'Unknown Channel';
    const views = viewsElement ? viewsElement.textContent.trim() : '0 views';
    const durationText = durationElement ? durationElement.textContent : '0:00';
    const description = descriptionElement ? descriptionElement.textContent.trim().substring(0, 500) : '';
    
    // Calculate duration in seconds
    const durationParts = durationText.split(':').map(Number);
    let duration = 0;
    if (durationParts.length === 3) {
      duration = durationParts[0] * 3600 + durationParts[1] * 60 + durationParts[2];
    } else if (durationParts.length === 2) {
      duration = durationParts[0] * 60 + durationParts[1];
    }
    
    return {
      videoId,
      title,
      channel,
      views,
      duration,
      durationText,
      description,
      url: window.location.href,
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      hasTranscript: transcriptCache.has(videoId)
    };
  }

  async function handleGetTranscript(videoId, sendResponse) {
    try {
      // Check cache first
      if (transcriptCache.has(videoId)) {
        const cached = transcriptCache.get(videoId);
        sendResponse({ success: true, data: cached.text, source: 'cache' });
        return;
      }
      
      // Try to extract from page
      const transcript = await extractTranscriptFromPage();
      
      if (transcript) {
        // Cache the result
        transcriptCache.set(videoId, {
          text: transcript,
          timestamp: Date.now(),
          source: 'page_extraction'
        });
        
        sendResponse({ success: true, data: transcript, source: 'extracted' });
      } else {
        sendResponse({ success: false, error: 'No transcript available' });
      }
      
    } catch (error) {
      console.error('Error getting transcript:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // Add floating action button for mobile
  function addFloatingButton() {
    if (window.innerWidth <= 768) {
      const fab = document.createElement('div');
      fab.id = 'ai-summarizer-fab';
      fab.innerHTML = '🤖';
      fab.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: white;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
        z-index: 9999;
        transition: all 0.3s ease;
      `;
      
      fab.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openPopup' });
      });
      
      document.body.appendChild(fab);
    }
  }

  // Add mobile support
  if (window.innerWidth <= 768) {
    addFloatingButton();
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (videoObserver) {
      videoObserver.disconnect();
    }
  });

})();