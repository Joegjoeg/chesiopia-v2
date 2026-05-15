class AuthApi {
    constructor() {
        this.baseUrl = this.getBaseUrl();
    }
    
    getBaseUrl() {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:3000';
        }
        return `${window.location.protocol}//${window.location.host}`;
    }
    
    async request(path, options = {}) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        const token = localStorage.getItem('authToken');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        try {
            const response = await fetch(url, {
                ...options,
                headers
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            
            return data;
        } catch (error) {
            console.error('[AuthApi] Request failed:', error);
            throw error;
        }
    }
    
    // Register: request verification code
    async register(email, username, password) {
        return this.request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, username, password })
        });
    }
    
    // Verify email code
    async verifyCode(email, code) {
        const result = await this.request('/api/auth/verify', {
            method: 'POST',
            body: JSON.stringify({ email, code })
        });
        
        if (result.success && result.token) {
            localStorage.setItem('authToken', result.token);
            localStorage.setItem('authUser', JSON.stringify(result.user));
        }
        
        return result;
    }
    
    // Login
    async login(identifier, password) {
        const result = await this.request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ identifier, password })
        });
        
        if (result.success && result.token) {
            localStorage.setItem('authToken', result.token);
            localStorage.setItem('authUser', JSON.stringify(result.user));
        }
        
        return result;
    }
    
    // Get current user
    async getMe() {
        return this.request('/api/auth/me');
    }
    
    // Logout
    logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('authUser');
        return this.request('/api/auth/logout', { method: 'POST' }).catch(() => ({}));
    }
}

// Export as singleton
window.authApi = new AuthApi();
