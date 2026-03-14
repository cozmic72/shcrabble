// Sound effects using Web Audio API
// Generates sounds programmatically without requiring audio files

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Helper to create and play a tone
function playTone(frequency, duration, type = 'sine', volume = 0.3) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = frequency;
  oscillator.type = type;

  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + duration);
}

// Helper to play a sequence of tones
function playSequence(notes) {
  let time = audioContext.currentTime;
  notes.forEach(note => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = note.freq;
    oscillator.type = note.type || 'sine';

    gainNode.gain.setValueAtTime(note.volume || 0.3, time);
    gainNode.gain.exponentialRampToValueAtTime(0.01, time + note.duration);

    oscillator.start(time);
    oscillator.stop(time + note.duration);

    time += note.duration;
  });
}

// Helper to create a subtle percussive click using noise
function playClick(duration = 0.03, volume = 0.08, filterFreq = 2000) {
  // Create white noise buffer
  const bufferSize = audioContext.sampleRate * duration;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  // Fill with random noise
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.3; // Softer noise
  }

  const noise = audioContext.createBufferSource();
  noise.buffer = buffer;

  // Filter to make it less harsh
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;

  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

  noise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioContext.destination);

  noise.start(audioContext.currentTime);
  noise.stop(audioContext.currentTime + duration);
}

const sounds = {
  // Tile placement - soft percussive click
  tilePlaced() {
    playClick(0.025, 0.06, 2500); // Very short, quiet, slightly brighter
  },

  // Tile picked up - softer, lower click
  tilePickup() {
    playClick(0.02, 0.04, 1800); // Even shorter, quieter, duller
  },

  // Move submitted - ascending notes
  moveSubmitted() {
    playSequence([
      { freq: 523.25, duration: 0.08, volume: 0.2 }, // C
      { freq: 659.25, duration: 0.08, volume: 0.2 }, // E
      { freq: 783.99, duration: 0.12, volume: 0.25 }  // G
    ]);
  },

  // Tiles recalled - descending
  tilesRecalled() {
    playSequence([
      { freq: 659.25, duration: 0.08, volume: 0.15 }, // E
      { freq: 523.25, duration: 0.12, volume: 0.15 }  // C
    ]);
  },

  // Your turn - attention-getting chime with emphasis
  yourTurn() {
    playSequence([
      { freq: 659.25, duration: 0.12, volume: 0.35 },  // E
      { freq: 783.99, duration: 0.12, volume: 0.35 },  // G
      { freq: 1046.5, duration: 0.18, volume: 0.4 },   // C (high) - louder, longer
      { freq: 783.99, duration: 0.12, volume: 0.3 }    // G (echo)
    ]);
  },

  // Opponent's turn - single soft note
  opponentTurn() {
    playTone(440, 0.1, 'sine', 0.15);
  },

  // Player joined - welcoming chime
  playerJoined() {
    playSequence([
      { freq: 659.25, duration: 0.08, volume: 0.2 },  // E
      { freq: 783.99, duration: 0.12, volume: 0.25 }  // G
    ]);
  },

  // Error - low buzz
  error() {
    playTone(200, 0.15, 'sawtooth', 0.2);
  },

  // Vote request - attention-getting sequence
  voteRequest() {
    playSequence([
      { freq: 523.25, duration: 0.1, volume: 0.2 },
      { freq: 659.25, duration: 0.1, volume: 0.2 },
      { freq: 523.25, duration: 0.1, volume: 0.2 }
    ]);
  },

  // Vote accepted - success chime
  voteAccepted() {
    playSequence([
      { freq: 523.25, duration: 0.08, volume: 0.25 },  // C
      { freq: 659.25, duration: 0.08, volume: 0.25 },  // E
      { freq: 783.99, duration: 0.08, volume: 0.3 },   // G
      { freq: 1046.5, duration: 0.15, volume: 0.35 }   // C (high)
    ]);
  },

  // Vote rejected - descending tones
  voteRejected() {
    playSequence([
      { freq: 659.25, duration: 0.1, volume: 0.2 },
      { freq: 523.25, duration: 0.1, volume: 0.2 },
      { freq: 415.30, duration: 0.15, volume: 0.25 }
    ]);
  },

  // Game ended - fanfare
  gameEnded() {
    playSequence([
      { freq: 523.25, duration: 0.12, volume: 0.25 },  // C
      { freq: 659.25, duration: 0.12, volume: 0.25 },  // E
      { freq: 783.99, duration: 0.12, volume: 0.3 },   // G
      { freq: 1046.5, duration: 0.25, volume: 0.35 }   // C (high)
    ]);
  }
};

// Export for use in game.js
window.sounds = sounds;
