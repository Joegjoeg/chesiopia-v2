class SoundManager {
    constructor() {
        this.audioContext = null;
        this.sounds = {};
        this.masterVolume = 0.8;
        this.lastGrumbleTime = 0;
        this.grumbleCooldown = 3000; // 3 seconds between grumbles
        this.footstepCooldown = 100; // 100ms between footsteps
        this.lastFootstepTime = 0;
        this.activeRumble = null;
        this.rumbleTimeout = null;
        this.rotationHum = null;
        
        this.initAudioContext();
    }
    
    initAudioContext() {
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // Check if AudioContext is suspended (browser security)
            if (this.audioContext.state === 'suspended') {
                console.log('[SoundManager] AudioContext is suspended, waiting for user interaction...');
                this.setupUserGestureHandler();
            } else {
                this.createSounds();
            }
        } catch (error) {
            console.error('[SoundManager] Failed to initialize AudioContext:', error);
        }
    }
    
    setupUserGestureHandler() {
        // Set up a one-time event listener to resume AudioContext on user interaction
        const resumeAudioContext = () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                console.log('[SoundManager] Resuming AudioContext after user gesture');
                this.audioContext.resume().then(() => {
                    console.log('[SoundManager] AudioContext resumed successfully');
                    this.createSounds();
                    console.log('[SoundManager] Sounds created after AudioContext resume');
                }).catch(error => {
                    console.error('[SoundManager] Failed to resume AudioContext:', error);
                });
                
                // Remove the event listeners after first interaction
                document.removeEventListener('click', resumeAudioContext);
                document.removeEventListener('keydown', resumeAudioContext);
                document.removeEventListener('mousedown', resumeAudioContext);
                document.removeEventListener('touchstart', resumeAudioContext);
            }
        };
        
        // Add multiple event listeners to catch different types of user interaction
        document.addEventListener('click', resumeAudioContext, { once: true });
        document.addEventListener('keydown', resumeAudioContext, { once: true });
        document.addEventListener('mousedown', resumeAudioContext, { once: true });
        document.addEventListener('touchstart', resumeAudioContext, { once: true });
    }
    
    createSounds() {
        if (!this.audioContext) return;
        
        // Create walking sounds using Web Audio API
        this.createWalkingSounds();
        
        // Create grumbling sounds (we'll use text-to-speech or generated sounds)
        this.setupGrumbling();
    }
    
    createWalkingSounds() {
        // Store reference to self for proper binding in arrow functions
        const self = this;
        
        // Create simple footstep sounds using oscillators and noise
        this.sounds.footstep = {
            play: (volume = 0.3) => {
                if (!self.audioContext) return;
                
                const now = self.audioContext.currentTime;
                const oscillator = self.audioContext.createOscillator();
                const gainNode = self.audioContext.createGain();
                const filter = self.audioContext.createBiquadFilter();
                
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
                gainNode.connect(self.audioContext.destination);
                
                oscillator.start(now);
                oscillator.stop(now + 0.1);
            }
        };
        
        // Create a slightly different footstep for variety
        this.sounds.footstep2 = {
            play: (volume = 0.3) => {
                if (!self.audioContext) return;
                
                const now = self.audioContext.currentTime;
                const oscillator = self.audioContext.createOscillator();
                const gainNode = self.audioContext.createGain();
                const filter = self.audioContext.createBiquadFilter();
                
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
                gainNode.connect(self.audioContext.destination);
                
                oscillator.start(now);
                oscillator.stop(now + 0.08);
            }
        };
        
        console.log('[SoundManager] Walking sounds created successfully');
        console.log('[SoundManager] Available sounds:', Object.keys(this.sounds));
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
        if (now - this.lastFootstepTime < this.footstepCooldown) {
            console.log(`[SoundManager] Footstep blocked by cooldown (${now - this.lastFootstepTime}ms < ${this.footstepCooldown}ms)`);
            return;
        }
        
        this.lastFootstepTime = now;
        
        // Alternate between different footstep sounds
        const footstepSound = Math.random() > 0.5 ? 'footstep' : 'footstep2';
        console.log(`[SoundManager] Playing footstep sound: ${footstepSound}`);
        if (this.sounds[footstepSound]) {
            this.sounds[footstepSound].play(this.masterVolume * 0.5);
        } else {
            console.log(`[SoundManager] Footstep sound '${footstepSound}' not found!`);
        }
    }
    
    playSplash() {
        if (!this.audioContext) return;
        const ctx = this.audioContext;
        const now = ctx.currentTime;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.0001, now);
        masterGain.connect(ctx.destination);

        const bufferSize = ctx.sampleRate * 0.3;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.5;
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2000, now);
        filter.frequency.exponentialRampToValueAtTime(800, now + 0.15);
        filter.Q.setValueAtTime(1.5, now);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.6 * this.masterVolume, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);

        noise.start(now);
        noise.stop(now + 0.3);

        masterGain.gain.linearRampToValueAtTime(0.5 * this.masterVolume, now + 0.02);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    }

    playHarumph(text = 'harumph', distanceToCamera = null) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.pitch = 1.6;
            utterance.rate = 0.85;
            let volume = 0.4 * this.masterVolume;
            if (distanceToCamera !== null) {
                volume = this.calculateDistanceVolume(distanceToCamera, volume);
            }
            utterance.volume = volume;
            utterance.lang = 'en-US';

            const voices = speechSynthesis.getVoices();
            const femaleVoice = voices.find(v =>
                v.name.includes('Female') ||
                v.name.includes('Samantha') ||
                v.name.includes('Karen') ||
                v.lang.includes('female')
            );
            if (femaleVoice) utterance.voice = femaleVoice;

            speechSynthesis.speak(utterance);
        }
    }

    setCursorBuzzMuffled(isMuffled, intensity = 1.0) {
        if (!this.audioContext || !this.cursorBuzz) return;
        const ctx = this.audioContext;
        const now = ctx.currentTime;
        const targetFreq = isMuffled ? 220 : 900;
        const targetQ = isMuffled ? 0.25 : 0.5;
        this.cursorBuzz.filter.frequency.setTargetAtTime(targetFreq, now, 0.15);
        this.cursorBuzz.filter.Q.setTargetAtTime(targetQ, now, 0.15);
        const baseFreq = this.cursorBuzz.baseFreq;
        const angryFreq = baseFreq + (isMuffled ? -30 : 60 * intensity);
        this.cursorBuzz.buzz1.frequency.setTargetAtTime(angryFreq, now, 0.1);
        this.cursorBuzz.buzz2.frequency.setTargetAtTime(angryFreq * 1.015, now, 0.1);
    }

    calculateDistanceVolume(distanceToCamera, baseVolume = 1.0) {
        const fadeStartDistance = 3;
        const fadeEndDistance = 70;
        const minVolume = 0.001;

        let volume = baseVolume;
        if (distanceToCamera > fadeStartDistance) {
            const fadeProgress = Math.min((distanceToCamera - fadeStartDistance) / (fadeEndDistance - fadeStartDistance), 1);
            volume = baseVolume * (1 - fadeProgress) + minVolume * fadeProgress;
        }
        return volume;
    }

    playGrumble(pieceType = null, distanceToCamera = null) {
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
            let volume = this.masterVolume * settings.volume;
            if (distanceToCamera !== null) {
                volume = this.calculateDistanceVolume(distanceToCamera, volume);
            }
            utterance.volume = volume;
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
    
    playMoveSound(pieceType = null, distanceToCamera = null) {
        // Play a sequence of footsteps for a move
        this.playFootstep();
        setTimeout(() => this.playFootstep(), 150);
        setTimeout(() => this.playFootstep(), 300);

        // Maybe add a grumble occasionally with piece type
        if (Math.random() > 0.7) {
            setTimeout(() => this.playGrumble(pieceType, distanceToCamera), 200);
        }
    }
    
    startRumble(options = {}) {
        if (!this.audioContext) return;
        const ctx = this.audioContext;

        const volume = Math.max(0, Math.min(1, options.volume ?? 0.65)) * this.masterVolume;
        const duration = Math.max(1, options.duration ?? 5);

        this.stopRumble();

        const now = ctx.currentTime;
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.0001, now);
        masterGain.connect(ctx.destination);

        // Low rumble oscillator (sub frequencies)
        const subOsc = ctx.createOscillator();
        subOsc.type = 'sawtooth';
        subOsc.frequency.setValueAtTime(34, now);
        subOsc.frequency.linearRampToValueAtTime(28, now + duration);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(volume * 0.35, now);
        subOsc.connect(subGain);
        subGain.connect(masterGain);
        subOsc.start(now);

        // Broadband noise filtered down for tectonic feel
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.6;
        }
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(120, now);
        noiseFilter.Q.setValueAtTime(0.7, now);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.5, now);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);
        noiseSource.start(now);

        masterGain.gain.linearRampToValueAtTime(volume, now + 0.45);

        this.activeRumble = {
            gain: masterGain,
            noiseSource,
            subOsc,
            stopTime: now + duration
        };

        if (this.rumbleTimeout) {
            clearTimeout(this.rumbleTimeout);
        }
        this.rumbleTimeout = setTimeout(() => this.stopRumble(), duration * 1000);
    }

    stopRumble(options = {}) {
        if (!this.audioContext || !this.activeRumble) return;
        const ctx = this.audioContext;
        const fade = Math.max(0.1, options.fade ?? 0.8);
        const now = ctx.currentTime;
        const { gain, noiseSource, subOsc } = this.activeRumble;

        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value || 0.0001, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + fade);

        setTimeout(() => {
            try {
                noiseSource.stop();
                subOsc.stop();
            } catch (err) {
                console.warn('[SoundManager] Rumbling stop error:', err);
            }
            gain.disconnect();
        }, fade * 1000 + 50);

        this.activeRumble = null;
        if (this.rumbleTimeout) {
            clearTimeout(this.rumbleTimeout);
            this.rumbleTimeout = null;
        }
    }

    playHeavenlyChorus(options = {}) {
        if (!this.audioContext) return;
        const ctx = this.audioContext;
        const intensity = Math.max(0.3, Math.min(1, options.intensity ?? 0.8));
        const now = ctx.currentTime;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.0001, now);
        masterGain.connect(ctx.destination);

        const chordFrequencies = [392, 494, 587]; // G major triad (G4, B4, D5)
        chordFrequencies.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            const oscGain = ctx.createGain();
            const delay = index * 0.12;
            oscGain.gain.setValueAtTime(0, now + delay);
            oscGain.gain.linearRampToValueAtTime(this.masterVolume * intensity * 0.5, now + delay + 0.6);
            oscGain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 3.2);
            osc.connect(oscGain);
            oscGain.connect(masterGain);
            osc.start(now + delay);
            osc.stop(now + delay + 3.5);
        });

        // Add shimmering arpeggio sweep
        const sweepOsc = ctx.createOscillator();
        sweepOsc.type = 'triangle';
        sweepOsc.frequency.setValueAtTime(660, now);
        sweepOsc.frequency.exponentialRampToValueAtTime(1760, now + 1.1);
        const sweepGain = ctx.createGain();
        sweepGain.gain.setValueAtTime(0, now);
        sweepGain.gain.linearRampToValueAtTime(this.masterVolume * intensity * 0.35, now + 0.3);
        sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
        sweepOsc.connect(sweepGain);
        sweepGain.connect(masterGain);
        sweepOsc.start(now);
        sweepOsc.stop(now + 1.3);

        // Gentle noise sparkle
        const sparkleBuffer = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
        const sparkleData = sparkleBuffer.getChannelData(0);
        for (let i = 0; i < sparkleData.length; i++) {
            sparkleData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sparkleData.length, 3);
        }
        const sparkleSource = ctx.createBufferSource();
        sparkleSource.buffer = sparkleBuffer;
        const hiPass = ctx.createBiquadFilter();
        hiPass.type = 'highpass';
        hiPass.frequency.setValueAtTime(1800, now);
        const sparkleGain = ctx.createGain();
        sparkleGain.gain.setValueAtTime(this.masterVolume * intensity * 0.15, now);
        sparkleSource.connect(hiPass);
        hiPass.connect(sparkleGain);
        sparkleGain.connect(masterGain);
        sparkleSource.start(now + 0.2);
        sparkleSource.stop(now + 1.4);

        masterGain.gain.linearRampToValueAtTime(this.masterVolume * intensity, now + 0.5);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);

        setTimeout(() => masterGain.disconnect(), 4200);
    }

    startRotationHum(options = {}) {
        if (!this.audioContext) return;
        if (this.rotationHum) return;
        const ctx = this.audioContext;
        const now = ctx.currentTime;
        const baseVolume = Math.max(0.1, Math.min(1, options.volume ?? 0.45));
        const wobbleRate = Math.max(0.1, Math.min(2, options.wobbleRate ?? 0.45));

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.connect(ctx.destination);

        const humOsc = ctx.createOscillator();
        humOsc.type = 'triangle';
        humOsc.frequency.setValueAtTime(92, now);

        const wobble = ctx.createOscillator();
        wobble.frequency.setValueAtTime(wobbleRate, now);
        const wobbleGain = ctx.createGain();
        wobbleGain.gain.setValueAtTime(18, now);
        wobble.connect(wobbleGain);
        wobbleGain.connect(humOsc.frequency);

        humOsc.connect(gain);
        humOsc.start(now);
        wobble.start(now);

        gain.gain.linearRampToValueAtTime(baseVolume * this.masterVolume, now + 0.5);

        this.rotationHum = {
            gain,
            humOsc,
            wobble,
            baseVolume
        };
    }

    updateRotationHum(distance = 0, maxDistance = 60) {
        if (!this.audioContext || !this.rotationHum) return;
        const ctx = this.audioContext;
        const attenuation = 1 - Math.min(Math.max(distance, 0) / Math.max(maxDistance, 1), 1);
        const target = this.rotationHum.baseVolume * attenuation * this.masterVolume;
        const now = ctx.currentTime;
        this.rotationHum.gain.gain.setTargetAtTime(Math.max(target, 0.0001), now, 0.08);
    }

    stopRotationHum(options = {}) {
        if (!this.audioContext || !this.rotationHum) return;
        const ctx = this.audioContext;
        const fade = Math.max(0.1, options.fade ?? 0.6);
        const now = ctx.currentTime;
        const { gain, humOsc, wobble } = this.rotationHum;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value || 0.0001, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + fade);
        setTimeout(() => {
            try {
                humOsc.stop();
                wobble.stop();
            } catch (err) {
                console.warn('[SoundManager] Rotation hum stop error:', err);
            }
            gain.disconnect();
        }, fade * 1000 + 50);
        this.rotationHum = null;
    }

    startCursorBuzz(options = {}) {
        if (!this.audioContext) return;
        if (this.cursorBuzz) return;
        const ctx = this.audioContext;
        const now = ctx.currentTime;
        let baseVolume = Math.max(0, Math.min(1, options.volume ?? 0.12));
        if (window.parameterSystem) {
            const paramVol = window.parameterSystem.getParameter('cursorBuzzVolume');
            if (typeof paramVol === 'number') baseVolume = paramVol;
        }
        if (baseVolume <= 0) {
            this.stopCursorBuzz();
            return;
        }

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.0001, now);
        masterGain.connect(ctx.destination);

        // Primary buzz oscillator (sawtooth for buzzy harmonics)
        const buzz1 = ctx.createOscillator();
        buzz1.type = 'sawtooth';
        buzz1.frequency.setValueAtTime(180, now);
        const buzz1Gain = ctx.createGain();
        buzz1Gain.gain.setValueAtTime(0.5 * baseVolume * this.masterVolume, now);
        buzz1.connect(buzz1Gain);
        buzz1Gain.connect(masterGain);
        buzz1.start(now);

        // Secondary oscillator slightly detuned for beating/insect richness
        const buzz2 = ctx.createOscillator();
        buzz2.type = 'triangle';
        buzz2.frequency.setValueAtTime(182, now);
        const buzz2Gain = ctx.createGain();
        buzz2Gain.gain.setValueAtTime(0.35 * baseVolume * this.masterVolume, now);
        buzz2.connect(buzz2Gain);
        buzz2Gain.connect(masterGain);
        buzz2.start(now);

        // Flutter LFO - amplitude modulation for wing-beat feel
        const flutter = ctx.createOscillator();
        flutter.type = 'sine';
        flutter.frequency.setValueAtTime(32, now);
        const flutterGain = ctx.createGain();
        flutterGain.gain.setValueAtTime(0.18 * baseVolume * this.masterVolume, now);
        flutter.connect(flutterGain);
        flutterGain.connect(masterGain.gain);
        flutter.start(now);

        // Lowpass filter to keep it soft/subtle
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900, now);
        filter.Q.setValueAtTime(0.5, now);

        // Re-wire through filter: disconnect from destination, reconnect
        masterGain.disconnect();
        masterGain.connect(filter);
        filter.connect(ctx.destination);

        masterGain.gain.linearRampToValueAtTime(1.0, now + 0.4);

        this.cursorBuzz = {
            masterGain,
            filter,
            buzz1,
            buzz2,
            buzz1Gain,
            buzz2Gain,
            flutter,
            flutterGain,
            baseVolume,
            baseFreq: 180,
            buzz1BaseGain: 0.5,
            buzz2BaseGain: 0.35,
            flutterBaseGain: 0.18
        };
    }

    updateCursorBuzz(speed = 0, distance = 20, isGrabbing = false, grabIntensity = 1.6) {
        if (!this.audioContext || !this.cursorBuzz) return;
        const ctx = this.audioContext;
        const now = ctx.currentTime;

        // Read live volume & fade params from parameter system
        let baseVolume = this.cursorBuzz.baseVolume;
        let fadeStart = 5;
        let fadeEnd = 80;
        if (window.parameterSystem) {
            const paramVol = window.parameterSystem.getParameter('cursorBuzzVolume');
            if (typeof paramVol === 'number') baseVolume = paramVol;
            const paramNear = window.parameterSystem.getParameter('cursorBuzzFadeNear');
            const paramFar = window.parameterSystem.getParameter('cursorBuzzFadeFar');
            if (typeof paramNear === 'number') fadeStart = paramNear;
            if (typeof paramFar === 'number') fadeEnd = paramFar;
        }
        if (baseVolume <= 0 || this.masterVolume <= 0) {
            this.stopCursorBuzz();
            return;
        }

        // Grabbing = extra effort: HIGHER pitch than fast flight
        const grabPitchOffset = isGrabbing ? +120 : 0;
        const targetFreq = this.cursorBuzz.baseFreq + grabPitchOffset + speed * 220;
        this.cursorBuzz.buzz1.frequency.setTargetAtTime(targetFreq, now, 0.06);
        // Moderate detune when grabbing for a strained, urgent feel
        this.cursorBuzz.buzz2.frequency.setTargetAtTime(targetFreq * (isGrabbing ? 1.04 : 1.015), now, 0.06);

        // Flutter rate: slightly faster when grabbing for frantic effort
        this.cursorBuzz.flutter.frequency.setTargetAtTime(
            (isGrabbing ? 38 : 28) + speed * 40, now, 0.08);

        // Distance attenuates volume: near = louder, far = quieter
        let distAtten = 1;
        if (distance > fadeStart) {
            distAtten = 1 - Math.min((distance - fadeStart) / (fadeEnd - fadeStart), 1);
            distAtten = Math.max(distAtten, 0.0);
        }

        // Speed also contributes a little to volume (moving wings are louder)
        const speedAmp = 0.6 + speed * 0.4;

        // Grabbing amplifies volume
        const grabVol = isGrabbing ? grabIntensity : 1.0;
        const targetVol = baseVolume * distAtten * speedAmp * grabVol * this.masterVolume;
        const { buzz1BaseGain, buzz2BaseGain, flutterBaseGain } = this.cursorBuzz;
        this.cursorBuzz.buzz1Gain.gain.setTargetAtTime(buzz1BaseGain * targetVol, now, 0.08);
        this.cursorBuzz.buzz2Gain.gain.setTargetAtTime(buzz2BaseGain * targetVol, now, 0.08);
        this.cursorBuzz.flutterGain.gain.setTargetAtTime(flutterBaseGain * targetVol, now, 0.08);

        // When grabbing, open filter for brighter high-pitch; close when idle for softness
        const targetFilterFreq = isGrabbing ? 2000 : 700;
        this.cursorBuzz.filter.frequency.setTargetAtTime(targetFilterFreq, now, 0.1);

        // Debug log on grab state change (throttled to max once per 200ms)
        const nowMs = performance.now();
        const stateChanged = isGrabbing !== this._lastBuzzGrabState;
        const intensityChanged = isGrabbing && Math.abs((this._lastBuzzIntensity || 0) - grabIntensity) > 0.1;
        if ((stateChanged || intensityChanged) && (nowMs - (this._lastBuzzLogTime || 0) > 200)) {
            // console.log('[SoundManager] updateCursorBuzz — isGrabbing=', isGrabbing, 'intensity=', grabIntensity, 'targetFreq=', targetFreq.toFixed(1), 'targetVol=', targetVol.toFixed(4), 'filter=', targetFilterFreq, 'distAtten=', distAtten.toFixed(3));
            this._lastBuzzLogTime = nowMs;
            this._lastBuzzGrabState = isGrabbing;
            this._lastBuzzIntensity = grabIntensity;
        }
    }

    stopCursorBuzz(options = {}) {
        if (!this.audioContext || !this.cursorBuzz) return;
        const ctx = this.audioContext;
        const fade = Math.max(0.1, options.fade ?? 0.5);
        const now = ctx.currentTime;
        const { masterGain, buzz1, buzz2, flutter } = this.cursorBuzz;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value || 0.0001, now);
        masterGain.gain.linearRampToValueAtTime(0.0001, now + fade);
        setTimeout(() => {
            try {
                buzz1.stop();
                buzz2.stop();
                flutter.stop();
            } catch (err) {
                console.warn('[SoundManager] Cursor buzz stop error:', err);
            }
            masterGain.disconnect();
        }, fade * 1000 + 50);
        this.cursorBuzz = null;
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
