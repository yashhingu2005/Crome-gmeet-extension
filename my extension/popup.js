// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const statusDiv = document.getElementById('status');

    // Load initial status from storage
    chrome.storage.local.get('isExtracting', (data) => {
        const isExtracting = data.isExtracting || false;
        updateStatus(isExtracting);
    });

    startButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'startExtraction' });
        updateStatus(true);
    });

    stopButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stopExtraction' });
        updateStatus(false);
    });

    // Function to update the status text and button states
    function updateStatus(isExtracting) {
        if (isExtracting) {
            statusDiv.textContent = 'Status: Extracting frames...';
            startButton.disabled = true;
            stopButton.disabled = false;
        } else {
            statusDiv.textContent = 'Status: Idle';
            startButton.disabled = false;
            stopButton.disabled = true;
        }
    }

    // Listen for status updates from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updatePopupStatus') {
            updateStatus(request.isExtracting);
        }
    });
});