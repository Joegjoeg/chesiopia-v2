class SoundManager {
    constructor() {
        this.audioContext = null;
        this.sounds = {};
        this.masterVolume = 0.5;
        this.lastGrumbleTime = 0;
        this.grumbleCooldown = 3000; // 3 seconds between grumbles
        this.footstepCooldown = 200; // 200ms between footsteps
        this.lastFootstepTime = 0;
        
        this.initAudioContext();
        this.createSounds();
    }
    
    initAudioContext() {
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
        } catch (e) {
            console.warn('Web Audio API not supported:', e);
        }
    }
    
    createSounds() {
        if (!this.audioContext) return;
        
        // Create walking sounds using Web Audio API
        this.createWalkingSounds();
        
        // Create grumbling sounds (we'll use text-to-speech or generated sounds)
        this.setupGrumbling();
    }
    
    createWalkingSounds() {
        // Create simple footstep sounds using oscillators and noise
        this.sounds.footstep = {
            play: (volume = 0.3) => {
                if (!this.audioContext) return;
                
                const now = this.audioContext.currentTime;
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();
                
                // Create a thump sound
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(80, now);
                oscillator.frequency.exponentialRampToValueAtTime(40, now + 0.1);
                
                // Filter to make it sound more like a footstep
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(200, now);
                
                // Quick envelope for footstep
                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                
                // Connect and play
                oscillator.connect(filter);
                filter.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                oscillator.start(now);
                oscillator.stop(now + 0.1);
            }
        };
        
        // Create a slightly different footstep for variety
        this.sounds.footstep2 = {
            play: (volume = 0.3) => {
                if (!this.audioContext) return;
                
                const now = this.audioContext.currentTime;
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                const filter = this.audioContext.createBiquadFilter();
                
                // Create a slightly different thump
                oscillator.type = 'triangle';
                oscillator.frequency.setValueAtTime(100, now);
                oscillator.frequency.exponentialRampToValueAtTime(50, now + 0.08);
                
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(300, now);
                
                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                
                oscillator.connect(filter);
                filter.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                oscillator.start(now);
                oscillator.stop(now + 0.08);
            }
        };
    }
    
    setupGrumbling() {
        // Complex voice personalities for each chess piece type
        this.pieceVoices = {
            king: {
                phrases: [
                    "This board is a narrow kingdom… yet all my doom fits upon it.",
                    "Stand fast. A king who flees has already fallen.",
                    "God's wounds, must I think for all of you?",
                    "By'r Lady... another burden to bear.",
                    "Gramercy… though it profits us little.",
                    "The crown weighs heavier than any sword.",
                    "One move wrong, and all is lost.",
                    "They call it 'game'... I call it 'gallows'."
                ],
                voiceSettings: { rate: 0.7, pitch: 0.6, volume: 0.8 },
                flavor: ["By'r Lady", "Gramercy", "God's wounds"]
            },
            queen: {
                phrases: [
                    "You mistake me for ornament.",
                    "Three moves hence—you are already dead.",
                    "Do try to be useful before you perish.",
                    "Have at thee... if you dare.",
                    "Soft now… let me think.",
                    "Your sacrifice will be noted. Briefly.",
                    "Chess is merely war by other means.",
                    "Beauty is a weapon, darling."
                ],
                voiceSettings: { rate: 0.9, pitch: 0.8, volume: 0.7 },
                flavor: ["Have at thee", "Soft now", "Indeed"]
            },
            bishop: {
                phrases: [
                    "All moves are seen. Not all are forgiven.",
                    "You advance… as does judgment.",
                    "Kneel, and be made useful.",
                    "Deus vult! The divine will moves through me.",
                    "In nomine Patris...",
                    "Your sins are written on the board.",
                    "God's justice has a long reach.",
                    "Even heretics must play their part."
                ],
                voiceSettings: { rate: 0.8, pitch: 0.7, volume: 0.75 },
                flavor: ["Deus vult", "In nomine Patris", "Amen"]
            },
            knight: {
                phrases: [
                    "A clean charge solves much.",
                    "Ha! A worthy clash at last!",
                    "Point me, and I shall break them.",
                    "For my liege! For honor!",
                    "Spur and strike!",
                    "The field calls for blood!",
                    "No finer death than in service!",
                    "To battle! To glory!"
                ],
                voiceSettings: { rate: 1.0, pitch: 0.9, volume: 0.8 },
                flavor: ["For my liege", "Spur and strike", "Ha!"]
            },
            rook: {
                phrases: [
                    "Hold. Break. Bite.",
                    "Shield up. Skull split.",
                    "No step past me.",
                    "Úlfhéðinn! The wolf within awakens!",
                    "Skeggǫld! The axe-age comes!",
                    "I am the wall. I am the end.",
                    "Bones break under my watch.",
                    "Death stands behind my shield."
                ],
                voiceSettings: { rate: 0.6, pitch: 0.5, volume: 0.9 },
                flavor: ["Úlfhéðinn", "Skeggǫld", "Break"]
            },
            pawn: {
                phrases: [
                    "Forward, is it? Aye… same as always.",
                    "Die I must, but I'll make it dear.",
                    "First to fall, last to be named.",
                    "Eh, well… on we go.",
                    "No lord dies first.",
                    "Another step toward the grave.",
                    "We're the meat in their sandwich.",
                    "Someone's got to be the fodder."
                ],
                voiceSettings: { rate: 0.9, pitch: 0.8, volume: 0.6 },
                flavor: ["Eh, well", "On we go", "Aye"]
            }
        };
        
        // Default grumbles for unknown piece types
        this.defaultGrumbles = [
            "Oh, not another move...",
            "My feet are killing me!",
            "Why do I have to do all the work?",
            "I'm too old for this nonsense!",
            "Bloody chess pieces, think they're so smart..."
        ];
        
        // Create a simple grumble sound effect
        this.sounds.grumble = {
            play: (volume = 0.4) => {
                if (!this.audioContext) return;
                
                const now = this.audioContext.currentTime;
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                
                // Create a low grumbling sound
                oscillator.type = 'sawtooth';
                oscillator.frequency.setValueAtTime(60, now);
                oscillator.frequency.linearRampToValueAtTime(40, now + 0.3);
                
                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(volume * 0.3, now + 0.05);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                
                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                oscillator.start(now);
                oscillator.stop(now + 0.3);
            }
        };
    }
    
    playFootstep() {
        const now = Date.now();
        if (now - this.lastFootstepTime < this.footstepCooldown) return;
        
        this.lastFootstepTime = now;
        
        // Alternate between different footstep sounds
        const footstepSound = Math.random() > 0.5 ? 'footstep' : 'footstep2';
        if (this.sounds[footstepSound]) {
            this.sounds[footstepSound].play(this.masterVolume * 0.5);
        }
    }
    
    playGrumble(pieceType = null) {
        const now = Date.now();
        if (now - this.lastGrumbleTime < this.grumbleCooldown) return;
        
        this.lastGrumbleTime = now;
        
        // Get voice configuration based on piece type
        let voiceConfig = null;
        if (pieceType && this.pieceVoices[pieceType]) {
            voiceConfig = this.pieceVoices[pieceType];
        } else {
            // Fallback to default grumbles
            voiceConfig = {
                phrases: this.defaultGrumbles,
                voiceSettings: { rate: 0.9, pitch: 0.8, volume: 0.7 },
                flavor: ["Eh", "Well", "Hmm"]
            };
        }
        
        // Play the grumble sound effect
        if (this.sounds.grumble) {
            this.sounds.grumble.play(this.masterVolume * 0.7);
        }
        
        // Try to use speech synthesis for the piece-specific voice
        if ('speechSynthesis' in window && voiceConfig) {
            const utterance = new SpeechSynthesisUtterance();
            
            // Choose between main phrases and flavor phrases
            const useFlavor = Math.random() > 0.7; // 30% chance for flavor
            const phrasePool = useFlavor ? voiceConfig.flavor : voiceConfig.phrases;
            utterance.text = phrasePool[Math.floor(Math.random() * phrasePool.length)];
            
            // Apply voice settings
            const settings = voiceConfig.voiceSettings;
            utterance.volume = this.masterVolume * settings.volume;
            utterance.rate = settings.rate;
            utterance.pitch = settings.pitch;
            utterance.voice = this.getVoiceForPiece(pieceType);
            
            speechSynthesis.speak(utterance);
        }
    }
    
    getVoiceForPiece(pieceType) {
        const voices = speechSynthesis.getVoices();
        if (!voices || voices.length === 0) return null;
        
        // Enhanced voice selection with more variety
        let preferredVoice = null;
        
        switch(pieceType) {
            case 'king':
                // Deep, authoritative voice - prefer bass/baritone voices
                preferredVoice = voices.find(v => 
                    (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('man')) &&
                    (v.name.toLowerCase().includes('baritone') || v.name.toLowerCase().includes('bass') || v.name.toLowerCase().includes('deep')) &&
                    v.lang.startsWith('en')
                ) || voices.find(v => 
                    (v.name.toLowerCase().includes('male') && v.lang.startsWith('en'))
                ) || voices.find(v => v.lang.startsWith('en'));
                break;
                
            case 'queen':
                // Elegant, sophisticated female voice - prefer soprano/alto
                preferredVoice = voices.find(v => 
                    (v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman')) &&
                    (v.name.toLowerCase().includes('soprano') || v.name.toLowerCase().includes('alto') || v.name.toLowerCase().includes('elegant')) &&
                    v.lang.startsWith('en')
                ) || voices.find(v => 
                    (v.name.toLowerCase().includes('female') && v.lang.startsWith('en'))
                ) || voices.find(v => v.lang.startsWith('en'));
                break;
                
            case 'bishop':
                // Solemn, religious-sounding voice - prefer deeper male voices
                preferredVoice = voices.find(v => 
                    (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('man')) &&
                    (v.name.toLowerCase().includes('british') || v.name.toLowerCase().includes('english') || v.name.toLowerCase().includes('formal')) &&
                    v.lang.startsWith('en')
                ) || voices.find(v => 
                    (v.name.toLowerCase().includes('male') && v.lang.startsWith('en'))
                ) || voices.find(v => v.lang.startsWith('en'));
                break;
                
            case 'knight':
                // Bold, confident warrior voice - prefer strong male voices
                preferredVoice = voices.find(v => 
                    (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('man')) &&
                    (v.name.toLowerCase().includes('strong') || v.name.toLowerCase().includes('confident') || v.name.toLowerCase().includes('bold')) &&
                    v.lang.startsWith('en')
                ) || voices.find(v => 
                    (v.name.toLowerCase().includes('male') && v.lang.startsWith('en'))
                ) || voices.find(v => v.lang.startsWith('en'));
                break;
                
            case 'rook':
                // Very deep, growling Norse voice - prefer very deep male voices
                preferredVoice = voices.find(v => 
                    (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('man')) &&
                    (v.name.toLowerCase().includes('deep') || v.name.toLowerCase().includes('dark') || v.name.toLowerCase().includes('growl')) &&
                    v.lang.startsWith('en')
                ) || voices.find(v => 
                    (v.name.toLowerCase().includes('male') && v.lang.startsWith('en'))
                ) || voices.find(v => v.lang.startsWith('en'));
                break;
                
            case 'pawn':
                // Working-class, common man voice - prefer natural male voices
                preferredVoice = voices.find(v => 
                    (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('man')) &&
                    (v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('regular') || v.name.toLowerCase().includes('common')) &&
                    v.lang.startsWith('en')
                ) || voices.find(v => 
                    (v.name.toLowerCase().includes('male') && v.lang.startsWith('en'))
                ) || voices.find(v => v.lang.startsWith('en'));
                break;
                
            default:
                // Any English voice for unknown pieces
                preferredVoice = voices.find(v => v.lang.startsWith('en'));
                break;
        }
        
        return preferredVoice || voices[0];
    }
    
    getGrumpyVoice() {
        // Legacy method - redirect to new system
        return this.getVoiceForPiece('pawn');
    }
    
    playMoveSound(pieceType = null) {
        // Play a sequence of footsteps for a move
        this.playFootstep();
        setTimeout(() => this.playFootstep(), 150);
        setTimeout(() => this.playFootstep(), 300);
        
        // Maybe add a grumble occasionally with piece type
        if (Math.random() > 0.7) {
            setTimeout(() => this.playGrumble(pieceType), 200);
        }
    }
    
    setMasterVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
    }
    
    // Resume audio context if it was suspended (browser requirement)
    resumeAudio() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }
}

// Create global sound manager
window.soundManager = new SoundManager();
