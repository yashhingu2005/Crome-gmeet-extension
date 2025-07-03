// content.js

// Use a global variable on the window object to prevent re-declaration errors
// if the content script is injected multiple times.
if (typeof window.meetFrameExtractionInterval === 'undefined') {
    window.meetFrameExtractionInterval = null;
}

const CAPTURE_INTERVAL_MS = 500; // Capture every 500 milliseconds (0.5 seconds)

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startContentScript') {
        startFrameExtraction();
        sendResponse({ status: 'started' }); // Acknowledge receipt
    } else if (request.action === 'stopContentScript') {
        stopFrameExtraction();
        sendResponse({ status: 'stopped' }); // Acknowledge receipt
    }
});

// Function to start extracting frames
function startFrameExtraction() {
    // Refer to the global variable
    if (window.meetFrameExtractionInterval) {
        console.log('Frame extraction already running.');
        return;
    }
    console.log('Starting frame extraction...');
    window.meetFrameExtractionInterval = setInterval(captureAndSendFrames, CAPTURE_INTERVAL_MS);
}

// Function to stop extracting frames
function stopFrameExtraction() {
    // Refer to the global variable
    if (window.meetFrameExtractionInterval) {
        clearInterval(window.meetFrameExtractionInterval);
        window.meetFrameExtractionInterval = null;
        console.log('Frame extraction stopped.');
    }
}

// Function to find the participant name associated with a video element
function getParticipantName(videoElement, index) {
    let name = `Participant ${index}`; // Default fallback name
    console.log(`Attempting to get name for video element ${index}.`);

    // --- STRATEGY: Find the highest-level container (view/block) for the video element ---
    // This is the div with data-participant-id="spaces/WpAK_GTtmC0B/devices/92" and class "oZRSLe"
    let participantContainer = videoElement.closest('[data-participant-id]');

    if (participantContainer) {
        console.log('Found participant container:', participantContainer);

        // --- NEW: Target the specific span.text-overflow within the participant container ---
        // Based on your latest screenshot, the name is in a span with class "text-overflow"
        // which is nested under a div with `jsslot=""` and then another div with
        // `style="text-overflow: ellipsis; overflow: hidden;"`.
        // We can target `span.text-overflow` directly within `participantContainer`.
        let nameElement = participantContainer.querySelector('span.text-overflow');
        if (nameElement) {
            let extractedName = nameElement.textContent.trim();
            // Basic sanity check: name should not be empty, too short (like single initial), too long
            if (extractedName && extractedName.length > 1 && extractedName.length < 50 && !/^[A-Z]$/.test(extractedName)) {
                console.log(`Found name via span.text-overflow within participant container: "${extractedName}"`);
                return extractedName;
            }
        }

        // --- Fallback: Try aria-label on the participant container itself ---
        if (participantContainer.hasAttribute('aria-label')) {
            const ariaLabel = participantContainer.getAttribute('aria-label');
            const match = ariaLabel.match(/(?:Video for|'s video)\s*(.+)/i);
            if (match && match[1]) {
                let extractedName = match[1].trim();
                if (extractedName && extractedName.length > 1 && extractedName.length < 50 && !/^[A-Z]$/.test(extractedName)) {
                    console.log(`Found name via participantContainer aria-label: "${extractedName}"`);
                    return extractedName;
                }
            }
        }

        // --- Other common name selectors within the container (less likely but kept as fallback) ---
        const otherNameSelectors = [
            'div[data-name]',
            'span[data-initial-participant-name]',
            'div[jsname][data-full-name]',
            'div[aria-label][data-is-name]',
            'div[role="heading"][aria-label]',
            'div[class*="vc-material-participant-name"]',
            'div[class*="participant-name-text"]',
            'span[class*="name-text"]',
            'div[class*="text-content"][data-self-name]',
            'div[class*="text-content"][data-participant-name]'
        ];

        for (let selector of otherNameSelectors) {
            let element = participantContainer.querySelector(selector);
            if (element) {
                let extractedName = element.textContent.trim();
                if (extractedName && extractedName.length > 1 && extractedName.length < 50 && !/^[A-Z]$/.test(extractedName)) {
                    console.log(`Found name via other selector (${selector}): "${extractedName}"`);
                    return extractedName;
                }
            }
        }
    } else {
        console.log('No high-level participant container found for video element (closest data-participant-id).');
    }

    // Fallback: Try to get name from aria-label of the video element itself (least reliable for full names)
    if (videoElement.hasAttribute('aria-label')) {
        const ariaLabel = videoElement.getAttribute('aria-label');
        const match = ariaLabel.match(/Video for (.+)/i);
        if (match && match[1]) {
            let extractedName = match[1].trim();
            if (extractedName && extractedName.length > 1 && extractedName.length < 50) {
                console.log(`Found name via videoElement aria-label fallback: "${extractedName}"`);
                return extractedName;
            }
        }
    }

    console.log(`No specific name found, falling back to default: "${name}"`);
    // Final fallback: Use the default "Participant X" if no name found
    return name;
}


// Main function to capture and send frames
function captureAndSendFrames() {
    const videoElements = document.querySelectorAll('video'); // Get all video elements

    if (videoElements.length === 0) {
        console.log('No video elements found on the page.');
        return;
    }

    let capturedCount = 0;
    videoElements.forEach((video, index) => {
        // Heuristic to filter relevant video elements:
        // - Check if the video is currently playing (readyState > 2)
        // - Check if it has a valid source object (e.g., from WebRTC)
        // - Check if it has non-zero dimensions
        if (video.readyState > 2 && video.srcObject && video.videoWidth > 0 && video.videoHeight > 0) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');

                // Draw the video frame onto the canvas
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Get the image data as a base64 string
                const imageData = canvas.toDataURL('image/jpeg', 0.8); // 0.8 quality for JPEG

                // Determine a participant ID. This is highly experimental.
                // Google Meet often assigns data-ssrc attributes or uses specific classes.
                // We'll try to use a data-ssrc if available, otherwise a simple index.
                const participantId = video.dataset.ssrc || `participant-${index}`;
                const participantName = getParticipantName(video, index); // Get the name

                // Send the frame data to the background script
                chrome.runtime.sendMessage({
                    action: 'sendFrameToBackground',
                    participantId: participantId,
                    imageData: imageData,
                    participantName: participantName // Send the extracted name
                });
                capturedCount++;

            } catch (error) {
                console.warn(`Error capturing frame from video element ${index}:`, error);
            }
        }
    });

    if (capturedCount === 0) {
        console.log('No active participant video frames found to capture.');
    }
}

// Initial check to see if extraction should be running (e.g., after a page refresh)
chrome.storage.local.get('isExtracting', (data) => {
    if (data.isExtracting) {
        console.log('Content script loaded, resuming extraction.');
        startFrameExtraction();
    }
});
