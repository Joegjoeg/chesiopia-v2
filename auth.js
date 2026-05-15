const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// In-memory store for pending verifications
const pendingVerifications = new Map();

// Rate limiting for auth requests (simple in-memory)
const rateLimits = new Map();

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'chesiopia-dev-secret-change-in-production';
const SALT_ROUNDS = 10;
const VERIFICATION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

// Ensure data directory exists
async function ensureDataDir() {
    const dataDir = path.join(__dirname, 'data');
    try {
        await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
        console.error('[Auth] Error creating data directory:', error);
    }
}

// Load users from file
async function loadUsers() {
    try {
        await ensureDataDir();
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

// Save users to file
async function saveUsers(users) {
    await ensureDataDir();
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

// Normalize email
function normalizeEmail(email) {
    return email.toLowerCase().trim();
}

// Generate a random 6-digit verification code
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Hash a verification code (short-lived, use crypto)
function hashCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

// Check rate limit
function checkRateLimit(key, windowMs = 60000, maxRequests = 3) {
    const now = Date.now();
    const entry = rateLimits.get(key);
    
    if (!entry || now > entry.resetTime) {
        rateLimits.set(key, {
            count: 1,
            resetTime: now + windowMs
        });
        return true;
    }
    
    if (entry.count >= maxRequests) {
        return false;
    }
    
    entry.count++;
    return true;
}

// Clean up expired rate limits periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimits) {
        if (now > entry.resetTime) {
            rateLimits.delete(key);
        }
    }
}, 60000);

// Clean up expired pending verifications periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pendingVerifications) {
        if (now > entry.expiresAt) {
            pendingVerifications.delete(key);
        }
    }
}, 300000); // Every 5 minutes

class AuthManager {
    constructor(emailService) {
        this.emailService = emailService;
        this.users = null;
        this.initialized = false;
    }
    
    async init() {
        if (this.initialized) return;
        this.users = await loadUsers();
        this.initialized = true;
        console.log(`[Auth] Loaded ${Object.keys(this.users).length} users`);
        
        // Seed dev user if it doesn't exist
        await this.seedDevUser();
    }
    
    async seedDevUser() {
        const devUsers = [
            { email: 'dev@chesiopia.local', username: 'Dev', password: 'dev123' },
            { email: 'joe@chesiopia.local', username: 'Joe', password: 'dev' }
        ];

        for (const dev of devUsers) {
            const normalizedEmail = normalizeEmail(dev.email);
            if (!this.users[normalizedEmail]) {
                const passwordHash = await bcrypt.hash(dev.password, SALT_ROUNDS);
                const devUser = {
                    id: crypto.randomUUID(),
                    email: dev.email,
                    username: dev.username,
                    passwordHash: passwordHash,
                    verifiedAt: new Date().toISOString(),
                    role: 'dev',
                    createdAt: new Date().toISOString()
                };
                this.users[normalizedEmail] = devUser;
                console.log(`[Auth] Dev user seeded: ${dev.email} / ${dev.password}`);
            }
        }

        await saveUsers(this.users);
    }
    
    // Request email verification for registration
    async requestVerification(email, username, password) {
        const normalizedEmail = normalizeEmail(email);
        
        // Rate limit
        if (!checkRateLimit(`verify:${normalizedEmail}`, 60000, 3)) {
            return { success: false, error: 'Too many requests. Please wait a minute.' };
        }
        
        // Check if user already exists and is verified
        if (this.users[normalizedEmail] && this.users[normalizedEmail].verifiedAt) {
            return { success: false, error: 'An account with this email already exists.' };
        }
        
        // Validate inputs
        if (!username || username.length < 2 || username.length > 20) {
            return { success: false, error: 'Username must be 2-20 characters.' };
        }
        
        if (!password || password.length < 6) {
            return { success: false, error: 'Password must be at least 6 characters.' };
        }
        
        // Generate verification code
        const code = generateVerificationCode();
        const codeHash = hashCode(code);
        
        // Hash password for temporary storage
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Store pending verification
        pendingVerifications.set(normalizedEmail, {
            codeHash,
            expiresAt: Date.now() + VERIFICATION_EXPIRY_MS,
            attempts: 0,
            pendingUserData: {
                email: normalizedEmail,
                username: username.trim(),
                passwordHash
            }
        });
        
        // Send email
        try {
            await this.emailService.sendVerificationEmail(normalizedEmail, code);
            console.log(`[Auth] Verification code sent to ${normalizedEmail}`);
            return { success: true, message: 'Verification code sent to your email.' };
        } catch (error) {
            console.error('[Auth] Failed to send verification email:', error);
            pendingVerifications.delete(normalizedEmail);
            return { success: false, error: 'Failed to send verification email. Please try again.' };
        }
    }
    
    // Verify email code and create account
    async verifyCode(email, code) {
        const normalizedEmail = normalizeEmail(email);
        const pending = pendingVerifications.get(normalizedEmail);
        
        if (!pending) {
            return { success: false, error: 'No pending verification found. Please register again.' };
        }
        
        if (Date.now() > pending.expiresAt) {
            pendingVerifications.delete(normalizedEmail);
            return { success: false, error: 'Verification code expired. Please request a new one.' };
        }
        
        if (pending.attempts >= MAX_ATTEMPTS) {
            pendingVerifications.delete(normalizedEmail);
            return { success: false, error: 'Too many failed attempts. Please request a new code.' };
        }
        
        pending.attempts++;
        
        // Verify code hash
        const codeHash = hashCode(code);
        if (codeHash !== pending.codeHash) {
            const remaining = MAX_ATTEMPTS - pending.attempts;
            return { 
                success: false, 
                error: `Invalid code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` 
            };
        }
        
        // Create user
        const user = {
            id: crypto.randomUUID(),
            email: pending.pendingUserData.email,
            username: pending.pendingUserData.username,
            passwordHash: pending.pendingUserData.passwordHash,
            verifiedAt: new Date().toISOString(),
            role: 'player',
            createdAt: new Date().toISOString()
        };
        
        this.users[normalizedEmail] = user;
        await saveUsers(this.users);
        
        // Clean up pending
        pendingVerifications.delete(normalizedEmail);
        
        // Generate token
        const token = this.generateToken(user);
        
        console.log(`[Auth] User verified and created: ${user.email}`);
        return { 
            success: true, 
            token,
            user: this.sanitizeUser(user)
        };
    }
    
    // Login with email/username and password
    async login(identifier, password) {
        const normalizedIdentifier = identifier.toLowerCase().trim();
        
        // Rate limit
        if (!checkRateLimit(`login:${normalizedIdentifier}`, 60000, 5)) {
            return { success: false, error: 'Too many login attempts. Please wait a minute.' };
        }
        
        let user = null;
        if (identifier.includes('@')) {
            const normalizedEmail = normalizeEmail(identifier);
            user = this.users[normalizedEmail] || null;
        } else {
            for (const existing of Object.values(this.users)) {
                if (existing.username && existing.username.toLowerCase() === normalizedIdentifier) {
                    user = existing;
                    break;
                }
            }
        }
        
        if (!user) {
            return { success: false, error: 'Invalid email/username or password.' };
        }
        
        if (!user.verifiedAt) {
            return { success: false, error: 'Account not verified. Please complete registration.' };
        }
        
        const validPassword = await bcrypt.compare(password, user.passwordHash);
        
        if (!validPassword) {
            return { success: false, error: 'Invalid email/username or password.' };
        }
        
        const token = this.generateToken(user);
        
        console.log(`[Auth] User logged in: ${user.email}`);
        return { 
            success: true, 
            token,
            user: this.sanitizeUser(user)
        };
    }
    
    // Verify JWT token
    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            return { valid: true, userId: decoded.userId, email: decoded.email, role: decoded.role };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }
    
    // Get user by ID
    getUserById(userId) {
        for (const user of Object.values(this.users)) {
            if (user.id === userId) {
                return this.sanitizeUser(user);
            }
        }
        return null;
    }
    
    // Get full user by email (for socket auth)
    getUserByEmail(email) {
        const normalizedEmail = normalizeEmail(email);
        return this.users[normalizedEmail] || null;
    }
    
    // Generate JWT token
    generateToken(user) {
        return jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                username: user.username,
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
    }
    
    // Sanitize user object for client
    sanitizeUser(user) {
        return {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            verifiedAt: user.verifiedAt
        };
    }
    
    // Middleware for Express routes
    requireAuth(req, res, next) {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const token = authHeader.substring(7);
        const result = this.verifyToken(token);
        
        if (!result.valid) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        
        req.user = result;
        next();
    }
    
    // Middleware for dev-only routes
    requireDev(req, res, next) {
        if (!req.user || req.user.role !== 'dev') {
            return res.status(403).json({ error: 'Dev access required' });
        }
        next();
    }
}

module.exports = AuthManager;
