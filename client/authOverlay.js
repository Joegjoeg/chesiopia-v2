class AuthOverlay {
    constructor() {
        this.overlay = null;
        this.currentView = 'choice'; // choice, login, register, verify, welcome
        this.pendingEmail = null;
        this.onAuthComplete = null;
        this.isVisible = false;
    }
    
    init(onAuthComplete) {
        this.onAuthComplete = onAuthComplete;
        this.createOverlay();
        this.createAccountBadge();
        
        // Check if already authenticated
        if (window.authState.isAuthenticated()) {
            window.authState.validate().then(valid => {
                if (valid) {
                    this.showWelcomeView();
                } else {
                    this.showChoiceView();
                }
            });
        } else {
            this.showChoiceView();
        }
    }
    
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'authOverlay';
        this.overlay.className = 'auth-overlay';
        this.overlay.innerHTML = `
            <div class="auth-window">
                <div class="auth-title-bar">
                    <span class="auth-title-text">Chessopia Login</span>
                    <span class="auth-title-icon">&#9632;</span>
                </div>
                <div class="auth-content" id="authContent">
                    <!-- Content injected dynamically -->
                </div>
            </div>
        `;
        document.body.appendChild(this.overlay);
        this.isVisible = true;
    }

    createAccountBadge() {
        this.accountBadge = document.createElement('button');
        this.accountBadge.id = 'accountBadge';
        this.accountBadge.textContent = 'Account';
        this.accountBadge.style.cssText = `
            position: fixed;
            top: 12px;
            left: 12px;
            padding: 6px 10px;
            background: #000080;
            color: #fff;
            font-family: 'Segoe UI', sans-serif;
            font-size: 11px;
            border: 1px solid #fff;
            border-radius: 4px;
            cursor: pointer;
            z-index: 9999;
            display: none;
        `;
        this.accountBadge.onclick = () => {
            if (window.authState.isAuthenticated()) {
                this.showWelcomeView();
            } else {
                this.showChoiceView();
            }
            this.show();
        };
        document.body.appendChild(this.accountBadge);

        const updateBadge = () => {
            const user = window.authState.getUser();
            if (user) {
                this.accountBadge.style.display = 'block';
                this.accountBadge.textContent = `${user.username || 'Player'}${user.role === 'dev' ? ' (Dev)' : ''}`;
            } else {
                this.accountBadge.style.display = 'none';
            }
        };

        if (window.authState) {
            window.authState.onChange(updateBadge);
            updateBadge();
        }
    }
    
    showChoiceView() {
        this.currentView = 'choice';
        const content = document.getElementById('authContent');
        content.innerHTML = `
            <div class="auth-choice">
                <div class="auth-logo">&#9812; CHESSOPIA</div>
                <div class="auth-subtitle">3D Infinite Chess</div>
                <div class="auth-buttons">
                    <button class="win31-btn auth-btn-primary" id="btnLogin">Login</button>
                    <button class="win31-btn auth-btn-primary" id="btnRegister">Create Account</button>
                </div>
                <div class="auth-separator">or</div>
                <button class="win31-btn auth-btn-guest" id="btnGuest">Continue as Guest</button>
                <div class="auth-hint">
                    Dev: dev@chesiopia.local / dev123<br>
                    Dev: joe@chesiopia.local / dev
                </div>
            </div>
        `;
        
        document.getElementById('btnLogin').onclick = () => this.showLoginView();
        document.getElementById('btnRegister').onclick = () => this.showRegisterView();
        document.getElementById('btnGuest').onclick = () => this.guestLogin();
    }
    
    showLoginView() {
        this.currentView = 'login';
        const content = document.getElementById('authContent');
        content.innerHTML = `
            <div class="auth-form">
                <div class="auth-form-title">Login</div>
                <div class="auth-field">
                    <label>Email or Username:</label>
                    <input type="text" class="win31-input" id="loginIdentifier" placeholder="your@email.com or Joe">
                </div>
                <div class="auth-field">
                    <label>Password:</label>
                    <input type="password" class="win31-input" id="loginPassword" placeholder="Enter password">
                </div>
                <div class="auth-error" id="loginError"></div>
                <div class="auth-buttons-row">
                    <button class="win31-btn" id="btnBackFromLogin">Back</button>
                    <button class="win31-btn auth-btn-primary" id="btnSubmitLogin">Login</button>
                </div>
            </div>
        `;
        
        document.getElementById('btnBackFromLogin').onclick = () => this.showChoiceView();
        document.getElementById('btnSubmitLogin').onclick = () => this.handleLogin();
        
        // Allow Enter key
        document.getElementById('loginPassword').onkeydown = (e) => {
            if (e.key === 'Enter') this.handleLogin();
        };
        
        // Focus email
        setTimeout(() => document.getElementById('loginIdentifier').focus(), 50);
    }
    
    showRegisterView() {
        this.currentView = 'register';
        const content = document.getElementById('authContent');
        content.innerHTML = `
            <div class="auth-form">
                <div class="auth-form-title">Create Account</div>
                <div class="auth-field">
                    <label>Username:</label>
                    <input type="text" class="win31-input" id="regUsername" placeholder="Your name" maxlength="20">
                </div>
                <div class="auth-field">
                    <label>Email:</label>
                    <input type="email" class="win31-input" id="regEmail" placeholder="your@email.com">
                </div>
                <div class="auth-field">
                    <label>Password:</label>
                    <input type="password" class="win31-input" id="regPassword" placeholder="Min 6 characters">
                </div>
                <div class="auth-error" id="regError"></div>
                <div class="auth-buttons-row">
                    <button class="win31-btn" id="btnBackFromReg">Back</button>
                    <button class="win31-btn auth-btn-primary" id="btnSubmitReg">Send Code</button>
                </div>
            </div>
        `;
        
        document.getElementById('btnBackFromReg').onclick = () => this.showChoiceView();
        document.getElementById('btnSubmitReg').onclick = () => this.handleRegister();
        
        document.getElementById('regPassword').onkeydown = (e) => {
            if (e.key === 'Enter') this.handleRegister();
        };
        
        setTimeout(() => document.getElementById('regUsername').focus(), 50);
    }
    
    showVerifyView() {
        this.currentView = 'verify';
        const content = document.getElementById('authContent');
        content.innerHTML = `
            <div class="auth-form">
                <div class="auth-form-title">Verify Email</div>
                <div class="auth-instructions">
                    A 6-digit code was sent to<br><strong>${this.pendingEmail}</strong><br>
                    (Check dev-emails.log if testing locally)
                </div>
                <div class="auth-field">
                    <label>Verification Code:</label>
                    <input type="text" class="win31-input auth-code-input" id="verifyCode" placeholder="000000" maxlength="6" inputmode="numeric">
                </div>
                <div class="auth-error" id="verifyError"></div>
                <div class="auth-buttons-row">
                    <button class="win31-btn" id="btnBackFromVerify">Back</button>
                    <button class="win31-btn auth-btn-primary" id="btnSubmitVerify">Verify</button>
                </div>
            </div>
        `;
        
        document.getElementById('btnBackFromVerify').onclick = () => this.showRegisterView();
        document.getElementById('btnSubmitVerify').onclick = () => this.handleVerify();
        
        document.getElementById('verifyCode').onkeydown = (e) => {
            if (e.key === 'Enter') this.handleVerify();
        };
        
        // Auto-format: only allow digits
        document.getElementById('verifyCode').oninput = (e) => {
            e.target.value = e.target.value.replace(/\D/g, '');
        };
        
        setTimeout(() => document.getElementById('verifyCode').focus(), 50);
    }
    
    showWelcomeView() {
        this.currentView = 'welcome';
        const user = window.authState.getUser();
        if (!user) {
            console.warn('[AuthOverlay] No user available for welcome view, returning to choice screen');
            this.showChoiceView();
            return;
        }
        const content = document.getElementById('authContent');
        content.innerHTML = `
            <div class="auth-welcome">
                <div class="auth-welcome-title">Welcome, ${user.username}!</div>
                <div class="auth-welcome-role">${user.role === 'dev' ? '&#9881; Developer' : '&#9817; Player'}</div>
                <button class="win31-btn auth-btn-primary auth-enter-btn" id="btnEnterGame">Enter Chessopia</button>
                <button class="win31-btn auth-btn-logout" id="btnLogout">Logout</button>
            </div>
        `;
        
        document.getElementById('btnEnterGame').onclick = () => this.enterGame();
        document.getElementById('btnLogout').onclick = () => this.handleLogout();
    }
    
    async handleLogin() {
        const identifier = document.getElementById('loginIdentifier').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        
        if (!identifier || !password) {
            errorEl.textContent = 'Please fill in all fields.';
            return;
        }
        
        errorEl.textContent = '';
        const btn = document.getElementById('btnSubmitLogin');
        btn.disabled = true;
        btn.textContent = 'Logging in...';
        
        try {
            const result = await window.authApi.login(identifier, password);
            if (result.success) {
                if (result.token && result.user) {
                    window.authState.setAuth(result.token, result.user);
                }
                this.showWelcomeView();
            } else {
                errorEl.textContent = result.error || 'Login failed.';
            }
        } catch (error) {
            errorEl.textContent = error.message || 'Network error. Please try again.';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Login';
        }
    }
    
    async handleRegister() {
        const username = document.getElementById('regUsername').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const errorEl = document.getElementById('regError');
        
        if (!username || !email || !password) {
            errorEl.textContent = 'Please fill in all fields.';
            return;
        }
        
        errorEl.textContent = '';
        const btn = document.getElementById('btnSubmitReg');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        
        try {
            const result = await window.authApi.register(email, username, password);
            if (result.success) {
                this.pendingEmail = email;
                this.showVerifyView();
            } else {
                errorEl.textContent = result.error || 'Registration failed.';
            }
        } catch (error) {
            errorEl.textContent = error.message || 'Network error. Please try again.';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Send Code';
        }
    }
    
    async handleVerify() {
        const code = document.getElementById('verifyCode').value.trim();
        const errorEl = document.getElementById('verifyError');
        
        if (code.length !== 6) {
            errorEl.textContent = 'Please enter the 6-digit code.';
            return;
        }
        
        errorEl.textContent = '';
        const btn = document.getElementById('btnSubmitVerify');
        btn.disabled = true;
        btn.textContent = 'Verifying...';
        
        try {
            const result = await window.authApi.verifyCode(this.pendingEmail, code);
            if (result.success) {
                if (result.token && result.user) {
                    window.authState.setAuth(result.token, result.user);
                }
                this.pendingEmail = null;
                this.showWelcomeView();
            } else {
                errorEl.textContent = result.error || 'Verification failed.';
            }
        } catch (error) {
            errorEl.textContent = error.message || 'Network error. Please try again.';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Verify';
        }
    }
    
    async handleLogout() {
        await window.authApi.logout();
        window.authState.clear();
        this.showChoiceView();
        this.show();
    }
    
    guestLogin() {
        // Create a temporary guest identity
        const guestUser = {
            id: 'guest_' + Math.random().toString(36).substr(2, 9),
            username: 'Guest',
            email: 'guest@local',
            role: 'guest'
        };
        window.authState.setAuth('guest-token-' + Date.now(), guestUser);
        this.enterGame();
    }
    
    enterGame() {
        this.hide();
        if (this.onAuthComplete) {
            this.onAuthComplete(window.authState.getUser());
        }
    }
    
    hide() {
        if (this.overlay) {
            this.overlay.style.display = 'none';
        }
        this.isVisible = false;
    }
    
    show() {
        if (this.overlay) {
            this.overlay.style.display = 'flex';
        }
        this.isVisible = true;
    }
}

// Export as singleton
window.authOverlay = new AuthOverlay();
