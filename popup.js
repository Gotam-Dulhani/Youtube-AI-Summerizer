const API_TOKEN = "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";

// Alternative free models that work better
const MODELS = {
  summarization: "facebook/bart-large-cnn",
  backup: "google/pegasus-xsum",
  fallback: "t5-small"
};

// Enhanced configuration for better summarization
const SUMMARY_CONFIG = {
  bullet: {
    maxLength: 150,
    minLength: 50,
    format: 'bullet'
  },
  paragraph: {
    maxLength: 300,
    minLength: 100,
    format: 'paragraph'
  },
  key: {
    maxLength: 200,
    minLength: 80,
    format: 'insights'
  }
};

let currentVideoData = null;
let summaryType = 'bullet';
let summaryLength = 2;

document.addEventListener("DOMContentLoaded", () => {
  initializeExtension();
});

function initializeExtension() {
  const button = document.getElementById("summarizeBtn");
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");
  const lengthSlider = document.getElementById("lengthSlider");
  const optionBtns = document.querySelectorAll(".option-btn");
  const copyBtn = document.getElementById("copyBtn");
  const exportBtn = document.getElementById("exportBtn");

  // Clean all text elements in the UI
  document.querySelectorAll('*').forEach(element => {
    if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) {
      element.textContent = cleanCorruptedUnicode(element.textContent);
    }
  });

  // Check if API token is set
  if (!API_TOKEN || API_TOKEN.trim() === "" || API_TOKEN.length < 30) {
    updateStatus("Warning: API token not configured. Please update the token in popup.js", true);
    button.disabled = true;
    return;
  }

  // Initialize option buttons
  optionBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      optionBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      summaryType = btn.dataset.type;
    });
  });

  // Initialize length slider
  lengthSlider.addEventListener("input", (e) => {
    summaryLength = parseInt(e.target.value);
  });

  // Copy functionality
  copyBtn.addEventListener("click", () => {
    const summaryText = document.getElementById("summaryContent").textContent;
    navigator.clipboard.writeText(summaryText);
    showToast("Summary copied to clipboard!");
  });

  // Export functionality
  exportBtn.addEventListener("click", () => {
    exportSummary();
  });

  // Main summarization button
  button.addEventListener("click", async () => {
    await startSummarization();
  });

  // Check if on YouTube and get video info
  checkYouTubeVideo();
}

async function checkYouTubeVideo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab && tab.url && tab.url.includes("youtube.com/watch")) {
      // Send message to content script to get video info
      chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' }, (response) => {
        if (chrome.runtime.lastError) {
          // Content script not loaded, try direct extraction
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: getVideoInfoDirect
          }, (results) => {
            if (results && results[0] && results[0].result) {
              currentVideoData = results[0].result;
              displayVideoInfo(currentVideoData);
              updateConnectionStatus("Connected", true);
            }
          });
        } else if (response && response.videoId) {
          currentVideoData = response;
          displayVideoInfo(response);
          updateConnectionStatus("Connected", true);
        }
      });
    } else {
      updateConnectionStatus("Not on YouTube", false);
      updateStatus("Please navigate to a YouTube video first", true);
    }
  } catch (error) {
    console.error("Error checking YouTube video:", error);
    updateConnectionStatus("Error", false);
  }
}

function getVideoInfoDirect() {
  try {
    const videoId = new URLSearchParams(window.location.search).get("v");
    if (!videoId) return null;
    
    const titleEl = document.querySelector("h1.ytd-video-primary-info-renderer yt-formatted-string, h1.style-scope.ytd-video-primary-info-renderer, #title h1");
    const channelEl = document.querySelector("#owner-name a, #channel-name a, .ytd-channel-name a");
    const viewsEl = document.querySelector("#info #count yt-view-count-renderer span, .view-count");
    const durationEl = document.querySelector(".ytp-time-duration");
    
    const title = titleEl ? titleEl.textContent.trim() : "Unknown Title";
    const channel = channelEl ? channelEl.textContent.trim() : "Unknown Channel";
    const viewsText = viewsEl ? viewsEl.textContent.trim() : "0 views";
    const durationText = durationEl ? durationEl.textContent : "0:00";
    
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
      viewsText,
      duration,
      durationText,
      url: window.location.href,
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    };
  } catch (error) {
    console.error("Error extracting video info:", error);
    return null;
  }
}

function displayVideoInfo(videoData) {
  const videoInfo = document.getElementById("videoInfo");
  const thumbnail = document.getElementById("videoThumbnail");
  const title = document.getElementById("videoTitle");
  const duration = document.getElementById("videoDuration");
  const views = document.getElementById("videoViews");

  thumbnail.innerHTML = "Play";
  title.textContent = videoData.title.length > 40 ? 
    videoData.title.substring(0, 40) + "..." : videoData.title;
  duration.textContent = videoData.durationText;
  views.textContent = videoData.viewsText;

  videoInfo.style.display = "flex";
}

function updateConnectionStatus(message, isConnected) {
  const statusIndicator = document.getElementById("connectionStatus");
  const statusDot = statusIndicator.querySelector(".status-dot");
  const statusText = statusIndicator.querySelector("span");

  statusText.textContent = message;
  statusDot.style.background = isConnected ? "#00ff88" : "#ff4444";
}

async function startSummarization() {
  const button = document.getElementById("summarizeBtn");
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");

  if (!currentVideoData) {
    updateStatus("Please open a YouTube video first", true);
    return;
  }

  try {
    // Start loading state
    button.classList.add("loading");
    resultEl.style.display = "none";
    
    updateStatus("Analyzing video content...", false);
    
    // Step 1: Get transcript
    const transcript = await getEnhancedTranscript(currentVideoData.videoId);
    
    if (!transcript || transcript.length < 50) {
      throw new Error("Unable to extract meaningful content from this video");
    }

    updateStatus("Processing with AI models...", false);
    
    // Step 2: Enhanced summarization with fallbacks
    const summary = await generateEnhancedSummary(transcript);
    
    // Step 3: Display results
    displaySummaryResults(summary, transcript);
    
    updateStatus("Summary generated successfully!", false, true);
    
  } catch (error) {
    updateStatus(`Error: ${error.message}`, true);
    console.error("Summarization Error:", error);
  } finally {
    button.classList.remove("loading");
  }
}

async function getEnhancedTranscript(videoId) {
  // Step 1: Try content script extraction first (most reliable)
  try {
    updateStatus("Checking for available transcripts...");
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractTranscriptFromYouTube,
      args: [videoId]
    });
    
    if (result && result.success && result.transcript && result.transcript.length > 100) {
      return cleanTranscript(result.transcript);
    }
    
    if (result && result.error) {
      console.log("Content script error:", result.error);
    }
    
  } catch (error) {
    console.log("Content script extraction failed:", error);
  }
  
  // Step 2: Try alternative extraction from video page HTML
  try {
    updateStatus("Trying alternative extraction method...");
    
    const transcript = await extractFromVideoPage(videoId);
    if (transcript && transcript.length > 100) {
      return cleanTranscript(transcript);
    }
  } catch (error) {
    console.log("Alternative extraction failed:", error);
  }
  
  // Step 3: Final fallback - use video description and comments
  try {
    updateStatus("Extracting from video description...");
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Get video description and title
        const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.style-scope.ytd-video-primary-info-renderer');
        const descEl = document.querySelector('#description-inner, #description yt-formatted-string, #description .content');
        
        const title = titleEl ? titleEl.textContent.trim() : '';
        const description = descEl ? descEl.textContent.trim() : '';
        
        // Try to get some comments as additional context
        const comments = Array.from(document.querySelectorAll('#content-text')).slice(0, 5)
          .map(el => el.textContent.trim())
          .filter(text => text.length > 20 && text.length < 200)
          .join(' ');
        
        // Combine title, description, and top comments
        const combined = `Title: ${title}\n\nDescription: ${description}\n\nViewer Comments: ${comments}`.substring(0, 4000);
        
        return combined.length > 200 ? combined : null;
      }
    });
    
    if (result && result.length > 200) {
      return result;
    }
    
  } catch (error) {
    console.log("Description extraction failed:", error);
  }
  
  throw new Error("No transcript or sufficient content available for this video. Please try a video with captions enabled, or one that has a detailed description.");
}

// This function runs in the content script context
function extractTranscriptFromYouTube(videoId) {
  return new Promise((resolve) => {
    try {
      // Updated selectors for current YouTube (2024/2025)
      const transcriptButtonSelectors = [
        'button[aria-label*="Show transcript"]',
        'button[aria-label*="Transcript"]', 
        '[aria-label*="Show transcript"]',
        'yt-button-renderer[aria-label*="transcript" i]',
        '.ytd-menu-renderer button[aria-label*="transcript" i]',
        'tp-yt-paper-button[aria-label*="transcript" i]'
      ];
      
      let transcriptButton = null;
      
      // First try to find transcript button in the more menu
      const moreButton = document.querySelector('button[aria-label*="More actions"], #menu button[aria-label*="More"]');
      if (moreButton && !document.querySelector('[aria-label*="Show transcript"]')) {
        moreButton.click();
        setTimeout(() => findAndClickTranscript(), 1000);
        return;
      }
      
      findAndClickTranscript();
      
      function findAndClickTranscript() {
        // Find transcript button
        for (const selector of transcriptButtonSelectors) {
          const buttons = document.querySelectorAll(selector);
          for (const button of buttons) {
            if (button.offsetParent !== null && !button.disabled && !button.getAttribute('aria-pressed')) {
              transcriptButton = button;
              break;
            }
          }
          if (transcriptButton) break;
        }
        
        if (!transcriptButton) {
          resolve({ success: false, error: "No transcript button found - video may not have captions" });
          return;
        }
        
        // Click transcript button
        transcriptButton.click();
        
        // Wait for transcript panel to load
        setTimeout(() => {
          try {
            // Try multiple selectors for transcript content
            const transcriptSelectors = [
              'ytd-transcript-segment-renderer .segment-text',
              '[data-target-id="engagement-panel-searchable-transcript"] .segment-text',
              '#transcript .segment-text',
              '.ytd-transcript-body-renderer .segment-text',
              'ytd-transcript-segment-list-renderer .segment-text',
              '.ytd-transcript-segment-renderer .segment-text',
              '#panels ytd-transcript-renderer .segment-text'
            ];
            
            let transcriptText = '';
            
            for (const selector of transcriptSelectors) {
              const segments = document.querySelectorAll(selector);
              if (segments.length > 0) {
                transcriptText = Array.from(segments)
                  .map(segment => segment.textContent.trim())
                  .filter(text => text.length > 0)
                  .join(' ');
                break;
              }
            }
            
            // If no segments found, try alternative approach
            if (!transcriptText) {
              const transcriptPanel = document.querySelector('#panels ytd-transcript-renderer, [target-id="engagement-panel-searchable-transcript"]');
              if (transcriptPanel) {
                // Try to get all text content from the panel
                const allText = transcriptPanel.textContent || transcriptPanel.innerText;
                if (allText && allText.length > 100) {
                  // Clean up the text by removing timestamps and extra whitespace
                  transcriptText = allText
                    .replace(/\d{1,2}:\d{2}/g, '') // Remove timestamps
                    .replace(/\s+/g, ' ')
                    .trim();
                }
              }
            }
            
            // Close transcript panel
            setTimeout(() => {
              const closeButtons = document.querySelectorAll('#panels button[aria-label*="Close"], tp-yt-iron-icon[icon="close"], button[aria-label*="Close transcript"]');
              for (const btn of closeButtons) {
                if (btn.offsetParent !== null) {
                  btn.click();
                  break;
                }
              }
            }, 500);
            
            if (transcriptText && transcriptText.length > 50) {
              resolve({ 
                success: true, 
                transcript: transcriptText,
                source: 'youtube_transcript'
              });
            } else {
              resolve({ success: false, error: "Transcript panel found but no text extracted" });
            }
            
          } catch (error) {
            resolve({ success: false, error: `Transcript extraction error: ${error.message}` });
          }
        }, 4000); // Wait 4 seconds for transcript to load
      }
      
    } catch (error) {
      resolve({ success: false, error: `Button click error: ${error.message}` });
    }
  });
}

// Alternative method to extract from video page HTML
async function extractFromVideoPage(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Look for subtitle/caption tracks in the page HTML
    const patterns = [
      /"captionTracks":\s*(\[.*?\])/,
      /"captions".*?"playerCaptionsTracklistRenderer".*?"captionTracks":\s*(\[.*?\])/,
      /ytInitialPlayerResponse.*?"captions".*?"captionTracks":\s*(\[.*?\])/
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        try {
          const captionTracks = JSON.parse(match[1]);
          
          // Prefer manual captions over auto-generated
          const preferredTrack = captionTracks.find(track => 
            (track.languageCode === 'en' || track.languageCode === 'en-US' || track.languageCode?.startsWith('en')) &&
            track.kind !== 'asr'
          ) || captionTracks.find(track => 
            track.languageCode === 'en' || track.languageCode === 'en-US' || track.languageCode?.startsWith('en')
          ) || captionTracks[0]; // Fallback to first available
          
          if (preferredTrack && preferredTrack.baseUrl) {
            const captionUrl = preferredTrack.baseUrl + '&fmt=srv3';
            const captionResponse = await fetch(captionUrl);
            
            if (captionResponse.ok) {
              const captionXml = await captionResponse.text();
              const parsed = parseSubtitleXML(captionXml);
              if (parsed && parsed.length > 100) {
                return parsed;
              }
            }
          }
        } catch (parseError) {
          console.log("Caption parsing failed:", parseError);
          continue;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log("Video page extraction failed:", error);
    return null;
  }
}

function parseSubtitleXML(xml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    
    // Handle both XML formats
    const textElements = doc.querySelectorAll('text, p');
    
    if (textElements.length === 0) return null;
    
    return Array.from(textElements)
      .map(el => {
        // Clean HTML entities and tags
        let text = el.textContent || el.innerHTML;
        return text
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&#x27;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .trim();
      })
      .filter(text => text.length > 0)
      .join(' ');
      
  } catch (error) {
    console.log("XML parsing failed:", error);
    return null;
  }
}

function cleanTranscript(transcript) {
  return cleanCorruptedUnicode(transcript)
    .replace(/(\d{1,2}:\d{2})\s+\1/g, '$1') // Remove duplicate timestamps
    .replace(/(subscribers|Videos About).*/gi, '') // Remove channel metadata
    .replace(/\s*\.{3,}\s*/g, '. ') // Clean excessive dots
    .replace(/(\w)\s+([A-Z]\w+)\s*:\s*/g, '$1. $2: '); // Fix broken sentences
}

function cleanAndFilterTranscript(transcript) {
  if (!transcript) return '';
  
  // First apply existing cleaning
  let cleaned = cleanTranscript(transcript);
  
  // Remove corrupted Unicode EARLY in the process
  cleaned = cleanCorruptedUnicode(cleaned);
  
  // Additional cleaning for better English content
  cleaned = cleaned
    // Remove repeated phone numbers or similar patterns
    .replace(/(\b\d{3}-\d{3}-\d{4}\b\s*){2,}/g, '')
    .replace(/(\b\d+\b\s*){10,}/g, '')
    .replace(/(.{1,20})\1{3,}/g, '$1')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  // Filter out if too much non-English content
  const words = cleaned.split(' ').filter(word => word.length > 1);
  const englishWords = words.filter(word => /^[a-zA-Z]+$/.test(word));
  
  if (englishWords.length / words.length < 0.7 && words.length > 10) {
    console.log("Warning: Content appears to have significant non-English content");
  }
  
  return cleaned;
}

async function generateEnhancedSummary(transcript) {
  const config = SUMMARY_CONFIG[summaryType];
  const lengthMultiplier = summaryLength / 2; // 0.5, 1, 1.5
  
  const maxLength = Math.floor(config.maxLength * lengthMultiplier);
  const minLength = Math.floor(config.minLength * lengthMultiplier);

  // Clean and filter transcript for better English content
  const cleanedTranscript = cleanAndFilterTranscript(transcript);
  
  if (!cleanedTranscript || cleanedTranscript.length < 50) {
    throw new Error("Unable to extract meaningful English content from this video");
  }

  // Split transcript into manageable chunks for large content
  if (cleanedTranscript.length > 2000) {
    const chunks = splitIntoChunks(cleanedTranscript, 1500);
    const summaries = [];

    for (let i = 0; i < Math.min(chunks.length, 3); i++) { // Limit to 3 chunks to avoid rate limits
      updateStatus(`Processing chunk ${i + 1}/${Math.min(chunks.length, 3)}...`);
      
      const chunkSummary = await summarizeChunkWithFallback(chunks[i], {
        maxLength: Math.floor(maxLength / Math.min(chunks.length, 3)) + 50,
        minLength: Math.floor(minLength / Math.min(chunks.length, 3)),
        format: config.format
      });
      
      if (chunkSummary && isValidEnglishSummary(chunkSummary)) {
        summaries.push(chunkSummary);
      }
      
      // Add delay to avoid rate limits
      if (i < Math.min(chunks.length, 3) - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Combine and format final summary
    const finalSummary = summaries.join(' ');
    return formatFinalSummary(finalSummary, summaryType);
  } else {
    // Single chunk processing
    const summary = await summarizeChunkWithFallback(cleanedTranscript, {
      maxLength,
      minLength,
      format: config.format
    });
    
    if (summary && isValidEnglishSummary(summary)) {
      return formatFinalSummary(summary, summaryType);
    } else {
      // Fallback to extractive summary
      const extractiveSummary = createExtractiveSummary(cleanedTranscript, config);
      return formatFinalSummary(extractiveSummary, summaryType);
    }
  }
}

function isValidEnglishSummary(summary) {
  if (!summary || summary.length < 20) return false;
  
  // Check for repeated patterns (like phone numbers)
  const repeatedPatterns = /(.{10,})\1{2,}/.test(summary);
  if (repeatedPatterns) return false;
  
  // Check for too many numbers
  const numberRatio = (summary.match(/\d/g) || []).length / summary.length;
  if (numberRatio > 0.3) return false; // More than 30% numbers
  
  // Check for corrupted Unicode patterns
  const corruptedUnicode = /[^\x00-\x7F]/g.test(summary);
  if (corruptedUnicode) return false;
  
  // Check if it has reasonable English words
  const words = summary.split(/\s+/).filter(word => word.length > 2);
  const englishWords = words.filter(word => /^[a-zA-Z]+$/.test(word));
  
  return englishWords.length / words.length > 0.6; // At least 60% English words
}

async function summarizeChunkWithFallback(text, config) {
  // Try primary model first with improved parameters
  for (const modelName of Object.values(MODELS)) {
    try {
      updateStatus(`Trying ${modelName.split('/')[1]}...`);
      
      const response = await fetch(`https://api-inference.huggingface.co/models/${modelName}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: text,
          parameters: {
            max_length: config.maxLength,
            min_length: config.minLength,
            do_sample: true,
            temperature: 0.3,
            top_k: 40,
            top_p: 0.9,
            repetition_penalty: 1.5,
            length_penalty: 1.2,
            no_repeat_ngram_size: 3
          },
          options: {
            wait_for_model: true
          }
        }),
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.error) {
          console.log(`Model ${modelName} returned error:`, result.error);
          continue;
        }
        
        let summaryText = result?.[0]?.summary_text || result?.summary_text || result?.[0]?.generated_text;
        
        // CLEAN THE SUMMARY IMMEDIATELY after getting it from API
        if (summaryText) {
          summaryText = cleanCorruptedUnicode(summaryText);
        }
        
        if (summaryText && summaryText.length > 20 && isValidEnglishSummary(summaryText)) {
          return summaryText;
        }
      } else if (response.status === 403) {
        throw new Error("API access denied. Please check your Hugging Face API token.");
      } else if (response.status === 503) {
        console.log(`Model ${modelName} is loading, trying next...`);
        continue;
      } else {
        console.log(`Model ${modelName} failed with status ${response.status}`);
        continue;
      }
      
    } catch (error) {
      console.log(`Error with model ${modelName}:`, error);
      continue;
    }
  }
  
  // All AI models failed, create extractive summary
  console.log("All AI models failed, creating extractive summary");
  const extractiveSummary = createExtractiveSummary(text, config);
  return cleanCorruptedUnicode(extractiveSummary); // Clean this too
}

function createExtractiveSummary(text, config) {
  try {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    // Score sentences based on length and common words
    const wordFreq = {};
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    const scoredSentences = sentences.map(sentence => {
      const sentenceWords = sentence.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const score = sentenceWords.reduce((sum, word) => sum + (wordFreq[word] || 0), 0) / sentenceWords.length;
      return { sentence: sentence.trim(), score };
    });
    
    // Sort by score and take top sentences
    const topSentences = scoredSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(5, Math.ceil(sentences.length / 4)))
      .map(item => item.sentence);
    
    return topSentences.join('. ') + '.';
    
  } catch (error) {
    console.error("Extractive summary failed:", error);
    // Last resort - return first few sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    return sentences.slice(0, 3).join('. ') + '.';
  }
}

function splitIntoChunks(text, maxChunkSize) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const sentenceLength = sentence.length;
    
    if (currentLength + sentenceLength > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join('. ') + '.');
      currentChunk = [sentence.trim()];
      currentLength = sentenceLength;
    } else {
      currentChunk.push(sentence.trim());
      currentLength += sentenceLength;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('. ') + '.');
  }

  return chunks.filter(chunk => chunk.length > 50);
}

function formatFinalSummary(summaryText, type) {
  if (!summaryText) return [];
  
  // Clean the summary text first
  const cleanedText = cleanCorruptedUnicode(summaryText);
  
  switch (type) {
    case 'bullet':
      return formatBulletPoints(cleanedText);
    case 'paragraph':
      return formatParagraph(cleanedText);
    case 'key':
      return formatKeyInsights(cleanedText);
    default:
      return [cleanedText];
  }
}

function cleanCorruptedUnicode(text) {
  if (!text) return '';
  
  // Remove corrupted Unicode symbols including â€¢ and similar
  return text
    .replace(/â€¢/g, '') // Remove the specific corrupted bullet symbol
    .replace(/â€\u009c/g, '') // Remove other corrupted patterns
    .replace(/â€\u009d/g, '')
    .replace(/â€™/g, "'") // Fix apostrophes
    .replace(/â€œ/g, '"') // Fix opening quotes
    .replace(/â€\u009d/g, '"') // Fix closing quotes
    .replace(/â€"/g, '-') // Fix dashes
    .replace(/[✔️✅]/g, '') // Remove checkmark symbols
    .replace(/[^\x20-\x7E\u2022\u00A0]/g, '') // Keep only basic ASCII + proper bullets
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

function formatFinalSummary(summaryText, type) {
  if (!summaryText) return [];
  
  const cleanedText = cleanCorruptedUnicode(summaryText);
  
  switch (type) {
    case 'bullet':
      return formatAsBulletPoints(cleanedText);
    case 'paragraph':
      return formatAsParagraph(cleanedText);
    case 'key':
      return formatAsKeyInsights(cleanedText);
    default:
      return [cleanedText];
  }
}

function formatAsBulletPoints(text) {
  // Split into logical points and clean each one
  return text.split(/(?:\n|\.\s)/)
    .map(point => {
      point = point.trim();
      if (point && !/[.!?]$/.test(point)) {
        point += '.';
      }
      return point;
    })
    .filter(point => point.length > 20)
    .slice(0, 8);
}

function formatAsParagraph(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const paragraphs = [];
  let currentParagraph = [];

  sentences.forEach((sentence, index) => {
    const cleanSentence = cleanCorruptedUnicode(sentence.trim());
    if (cleanSentence && cleanSentence.length > 5) {
      currentParagraph.push(cleanSentence);
    }
    
    if (currentParagraph.length >= 3 || index === sentences.length - 1) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join('. ') + '.');
        currentParagraph = [];
      }
    }
  });

  return paragraphs;
}

function formatAsKeyInsights(text) {
  return formatAsBulletPoints(text)
    .map(insight => insight.replace(/^•\s*/, ''))
    .slice(0, 6);
}

function displaySummaryResults(summary, originalTranscript) {
  const resultEl = document.getElementById("result");
  const summaryContent = document.getElementById("summaryContent");
  const summaryStats = document.getElementById("summaryStats");

  const formattedSummary = formatFinalSummary(
    Array.isArray(summary) ? summary.join(' ') : summary,
    summaryType
  );

  let htmlContent = '';
  if (summaryType === 'bullet' || summaryType === 'key') {
    htmlContent = `<ul>${formattedSummary.map(point => 
      `<li>${point}</li>`
    ).join('')}</ul>`;
  } else {
    htmlContent = formattedSummary.map(para => 
      `<p>${para}</p>`
    ).join('');
  }

  summaryContent.innerHTML = htmlContent;

  // Calculate and display stats
  const originalWords = originalTranscript.split(' ').length;
  const summaryWords = summaryContent.textContent.split(' ').length;
  const compressionRatio = originalWords > 0 ? ((1 - summaryWords / originalWords) * 100).toFixed(1) : '0';
  const readingTime = Math.ceil(summaryWords / 200);

  summaryStats.innerHTML = `
    <span>Stats: ${summaryWords} words (${compressionRatio}% compression)</span>
    <span>Reading time: ${readingTime} min</span>
    <span>Key points: ${formattedSummary.length}</span>
  `;

  resultEl.style.display = "block";
}

function updateStatus(message, isError = false, isSuccess = false) {
  const statusEl = document.getElementById("status");
  statusEl.innerHTML = `<span>${message}</span>`;
  statusEl.className = "status-message";
  
  if (isError) {
    statusEl.classList.add("error");
    // Add helpful suggestions for different error types
    if (message.includes('transcript') || message.includes('content')) {
      statusEl.innerHTML += `
        <div style="margin-top: 8px; font-size: 12px; opacity: 0.8;">
          Tip: Try videos with captions enabled, or popular videos with auto-generated subtitles
        </div>
      `;
    } else if (message.includes('API') || message.includes('token')) {
      statusEl.innerHTML += `
        <div style="margin-top: 8px; font-size: 12px; opacity: 0.8;">
          Tip: Get a free API token from: <a href="https://huggingface.co/settings/tokens" target="_blank">huggingface.co/settings/tokens</a>
        </div>
      `;
    }
  } else if (isSuccess) {
    statusEl.classList.add("success");
  }
}

function showToast(message) {
  // Create temporary toast notification
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #38a169;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    animation: slideInRight 0.3s ease;
  `;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 2500);
}

function exportSummary() {
  if (!currentVideoData) return;
  
  const summaryText = document.getElementById("summaryContent").textContent;
  const timestamp = new Date().toISOString().split('T')[0];
  
  const exportData = {
    title: currentVideoData.title,
    videoId: currentVideoData.videoId,
    url: `https://youtube.com/watch?v=${currentVideoData.videoId}`,
    duration: currentVideoData.durationText,
    summaryType: summaryType,
    summaryLength: summaryLength,
    summary: summaryText,
    generatedAt: new Date().toISOString(),
    wordCount: summaryText.split(' ').length
  };

  // Create and download JSON file
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
    type: 'application/json' 
  });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `youtube-summary-${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast("Summary exported successfully!");
}

// Enhanced error handling
window.addEventListener('error', (event) => {
  console.error('Extension error:', event.error);
  updateStatus('An unexpected error occurred. Please try again.', true);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  updateStatus('Connection error. Please check your internet and try again.', true);
});

// Add CSS animations for toast
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Utility function to retry API calls with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      
      const delay = baseDelay * Math.pow(2, i);
      console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms delay`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Initialize settings from storage
chrome.storage.sync.get([
  'defaultSummaryType',
  'defaultLength',
  'autoDetectLanguage',
  'preferredModel'
], (result) => {
  if (result.defaultSummaryType) {
    summaryType = result.defaultSummaryType;
    document.querySelector(`[data-type="${summaryType}"]`)?.classList.add('active');
  }
  
  if (result.defaultLength) {
    summaryLength = result.defaultLength;
    document.getElementById('lengthSlider').value = summaryLength;
  }
});

// Save settings on change
function saveSettings() {
  chrome.storage.sync.set({
    defaultSummaryType: summaryType,
    defaultLength: summaryLength,
    lastUsed: Date.now()
  });
}

// Add event listeners to save settings
document.addEventListener('change', saveSettings);
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('option-btn')) {
    saveSettings();
  }
});