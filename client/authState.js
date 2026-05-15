class AuthState {
    constructor() {
        this.token = localStorage.getItem('authToken');
        this.user = null;
        this.listeners = [];
        
        const storedUser = localStorage.getItem('authUser');
        if (storedUser) {
            try {
                this.user = JSON.parse(storedUser);
            } catch (e) {
                console.error('[AuthState] Failed to parse stored user:', e);
                this.clear();
            }
        }
    }
    
    isAuthenticated() {
        return !!this.token && !!this.user;
    }
    
    isDev() {
        return this.user?.role === 'dev';
    }
    
    getToken() {
        return this.token;
    }
    
    getUser() {
        return this.user;
    }
    
    setAuth(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('authToken', token);
        localStorage.setItem('authUser', JSON.stringify(user));
        this.notifyListeners('authChanged', { token, user });
    }
    
    clear() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
        this.notifyListeners('authChanged', { token: null, user: null });
    }
    
    onChange(callback) {
        this.listeners.push(callback);
        return () => {
            const index = this.listeners.indexOf(callback);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }
    
    notifyListeners(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (error) {
                console.error('[AuthState] Listener error:', error);
            }
        });
    }
    
    // Validate token with server
    async validate() {
        if (!this.token) return false;
        
        try {
            const result = await window.authApi.getMe();
            if (result.success && result.user) {
                this.user = result.user;
                localStorage.setItem('authUser', JSON.stringify(result.user));
                return true;
            }
        } catch (error) {
            console.log('[AuthState] Token validation failed:', error.message);
        }
        
        this.clear();
        return false;
    }
}

// Export as singleton
window.authState = new AuthState();
