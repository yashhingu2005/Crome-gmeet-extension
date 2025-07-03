# app.py
from flask import Flask, render_template, request, Response, jsonify
from flask_cors import CORS
import base64
import json
import time
import threading
import os

app = Flask(__name__)
# Explicitly enable CORS for the /upload_frame endpoint with specific origins
CORS(app, origins=["http://127.0.0.1:5000", "https://meet.google.com", "null"])


# Dictionary to store the latest frame for each participant, now including name
# Format: { 'participant_identifier': { 'image_data': 'base64_image_data', 'name': 'Participant Name', 'last_seen': timestamp } }
latest_frames = {}
# A lock to ensure thread-safe access to latest_frames
frames_lock = threading.Lock()
# Event to signal when new frames are available for SSE clients
new_frame_event = threading.Event()

# Timeout for how long a frame should persist after not being seen (in seconds)
# Set to a higher value (e.g., 30-60 seconds) if you want frames to linger longer
# Set to a lower value (e.g., 5-10 seconds) if you want them to disappear faster
FRAME_PERSISTENCE_TIMEOUT = 10 # seconds

@app.route('/')
def index():
    """Renders the main HTML page to display participant frames."""
    return render_template('index.html')

@app.route('/upload_frame', methods=['POST'])
def upload_frame():
    """
    Receives base64 image data and participant name from the Chrome extension.
    Updates the latest_frames dictionary and signals new data.
    """
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "No JSON data received"}), 400

    participant_id = data.get('participant_id') # This is the dynamic ssrc or index
    image_data = data.get('image_data') # This will be a base64 string like "data:image/jpeg;base64,..."
    participant_name = data.get('participant_name', f"Participant {participant_id.split('-')[-1]}") # Get name, fallback to ID

    if not participant_id or not image_data:
        return jsonify({"status": "error", "message": "Missing participant_id or image_data"}), 400

    # Use the name as the primary identifier if available, otherwise fallback to the dynamic ID
    # This helps in tracking the same person if their dynamic ID changes but name stays
    identifier = participant_name if participant_name and not participant_name.startswith('Participant ') else participant_id

    with frames_lock:
        latest_frames[identifier] = {
            'image_data': image_data,
            'name': participant_name,
            'original_id': participant_id, # Keep original ID for debugging if needed
            'last_seen': time.time() # Record when this frame was last seen
        }
        # print(f"Received frame for {participant_name} ({participant_id}). Stored as: {identifier}. Total frames: {len(latest_frames)}")

    # Signal that new frames are available
    new_frame_event.set()

    return jsonify({"status": "success", "message": f"Frame received for {participant_name}"}), 200

@app.route('/stream_frames')
def stream_frames():
    """
    Server-Sent Events (SSE) endpoint to push frame updates to clients.
    Clients connect to this endpoint to receive real-time updates of frames.
    """
    def generate_frames():
        last_sent_frames = {}
        while True:
            # Wait for a new frame event, with a timeout to periodically check
            # if the client is still connected or if there are new frames even without an event.
            new_frame_event.wait(timeout=1) # Wait for up to 1 second for a new event
            new_frame_event.clear() # Clear the event for the next cycle

            current_time = time.time()
            frames_to_send = {}
            identifiers_to_remove = []

            with frames_lock:
                for identifier, frame_data in latest_frames.items():
                    # If frame is older than timeout, mark for removal
                    if (current_time - frame_data['last_seen']) > FRAME_PERSISTENCE_TIMEOUT:
                        identifiers_to_remove.append(identifier)
                    else:
                        # Only send necessary data to client
                        frames_to_send[identifier] = {
                            'image_data': frame_data['image_data'],
                            'name': frame_data['name']
                        }

                # Remove old frames
                for identifier in identifiers_to_remove:
                    if identifier in latest_frames:
                        del latest_frames[identifier]
                        # print(f"Removed stale frame for {identifier}")

            # Only send data if there's a change
            if frames_to_send != last_sent_frames:
                yield f"data: {json.dumps(frames_to_send)}\n\n"
                last_sent_frames = frames_to_send.copy()
            else:
                # If no new frames, send a keep-alive comment to prevent connection timeout
                yield ": keep-alive\n\n"

            time.sleep(0.1) # Small delay to prevent busy-waiting

    return Response(generate_frames(), mimetype='text/event-stream')

if __name__ == '__main__':
    # Run the Flask app on 127.0.0.1:5000
    app.run(host='127.0.0.1', port=5000, debug=True)