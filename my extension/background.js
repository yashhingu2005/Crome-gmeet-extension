// background.js
let extractionIntervalId = null; // To store the interval ID for content script
const FLASK_SERVER_URL = 'http://127.0.0.1:5000/upload_frame'; // Your Flask server endpoint

// Listen for messages from the popup script or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startExtraction') {
        startExtraction();
    } else if (request.action === 'stopExtraction') {
        stopExtraction();
    } else if (request.action === 'sendFrameToBackground') {
        // Handle the message from the content script to send a frame
        sendFrameToFlask(request.participantId, request.imageData, request.participantName);
        // No sendResponse needed here as content script doesn't await this
    }
});

// Function to start the extraction process
async function startExtraction() {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url && tab.url.startsWith('https://meet.google.com')) {
        // Store the extraction status in local storage
        await chrome.storage.local.set({ isExtracting: true, targetTabId: tab.id });

        // Inject the content script into the active tab
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        }, () => {
            if (chrome.runtime.lastError) {
                console.error("Script injection failed: ", chrome.runtime.lastError.message);
                // If injection fails, reset status
                chrome.storage.local.set({ isExtracting: false, targetTabId: null });
                chrome.runtime.sendMessage({ action: 'updatePopupStatus', isExtracting: false });
                return;
            }
            // Send a message to the content script to start its process
            chrome.tabs.sendMessage(tab.id, { action: 'startContentScript' });
            chrome.runtime.sendMessage({ action: 'updatePopupStatus', isExtracting: true });
            console.log('Extraction started for tab:', tab.id);
        });
    } else {
        console.warn('Not on a Google Meet page.');
        chrome.runtime.sendMessage({ action: 'updatePopupStatus', isExtracting: false });
    }
}

// Function to stop the extraction process
async function stopExtraction() {
    const data = await chrome.storage.local.get('targetTabId');
    const targetTabId = data.targetTabId;

    if (targetTabId) {
        // Send a message to the content script to stop its process
        chrome.tabs.sendMessage(targetTabId, { action: 'stopContentScript' }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Could not send stop message to content script (tab might be closed): ", chrome.runtime.lastError.message);
            }
            // Clear storage and update popup status regardless
            chrome.storage.local.set({ isExtracting: false, targetTabId: null });
            chrome.runtime.sendMessage({ action: 'updatePopupStatus', isExtracting: false });
            console.log('Extraction stopped.');
        });
    } else {
        // If no targetTabId, just reset storage and status
        chrome.storage.local.set({ isExtracting: false, targetTabId: null });
        chrome.runtime.sendMessage({ action: 'updatePopupStatus', isExtracting: false });
        console.log('Extraction already stopped or no active tab.');
    }
}

// Function to send the frame data to the Flask server (now in background script)
async function sendFrameToFlask(participantId, imageData, participantName) {
    try {
        const response = await fetch(FLASK_SERVER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                participant_id: participantId,
                image_data: imageData,
                participant_name: participantName // Send the name
            })
        });

        if (!response.ok) {
            console.error(`Failed to send frame for ${participantName} (${participantId}) from background:`, response.statusText);
        } else {
            // console.log(`Successfully sent frame for ${participantName} (${participantId}) from background.`);
        }
    } catch (error) {
        console.error(`Network error sending frame for ${participantName} (${participantId}) from background:`, error);
    }
}


// Listen for tab updates (e.g., tab closed or navigated away)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    chrome.storage.local.get('targetTabId', (data) => {
        if (data.targetTabId === tabId) {
            console.log(`Target tab ${tabId} closed. Stopping extraction.`);
            stopExtraction(); // Automatically stop if the target tab is closed
        }
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    chrome.storage.local.get('targetTabId', (data) => {
        if (data.targetTabId === tabId && changeInfo.url && !changeInfo.url.startsWith('https://meet.google.com')) {
            console.log(`Target tab ${tabId} navigated away from Google Meet. Stopping extraction.`);
            stopExtraction(); // Automatically stop if the target tab navigates away
        }
    });
});
