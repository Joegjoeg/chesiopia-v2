class ServerErrorDisplay {
    constructor() {
        this.errorList = document.getElementById('errorList');
        this.clearErrorsBtn = document.getElementById('clearErrorsBtn');
        this.maxErrors = 50; // Limit to prevent memory issues
        this.networkManager = null;
        
        this.setupEventListeners();
        this.setupClientErrorInterceptor();
        console.log('[ServerErrorDisplay] Initialized');
    }
    
    setupEventListeners() {
        // Clear errors button
        if (this.clearErrorsBtn) {
            this.clearErrorsBtn.addEventListener('click', () => {
                this.clearErrors();
            });
        }
    }
    
    setupClientErrorInterceptor() {
        // Override window.onerror to catch unhandled JavaScript errors
        const originalOnError = window.onerror;
        
        window.onerror = (message, source, lineno, colno, error) => {
            // Create client error data
            const clientError = {
                type: 'client-error',
                message: `${message} at ${source}:${lineno}:${colno}`,
                stack: error ? error.stack : 'No stack trace available',
                timestamp: new Date().toISOString(),
                source: source,
                line: lineno,
                column: colno
            };
            
            // Display locally
            this.addError(clientError);
            
            // Forward to server if network is available
            this.forwardToServer(clientError);
            
            // Call original error handler
            if (originalOnError) {
                return originalOnError(message, source, lineno, colno, error);
            }
            
            return false; // Prevent default error handling
        };
        
        // Also catch unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            const clientError = {
                type: 'client-rejection',
                message: `Unhandled promise rejection: ${event.reason}`,
                stack: event.reason && event.reason.stack ? event.reason.stack : 'No stack trace',
                timestamp: new Date().toISOString()
            };
            
            this.addError(clientError);
            this.forwardToServer(clientError);
        });
        
        console.log('[ServerErrorDisplay] Client error interceptor setup complete');
    }
    
    // Set network manager reference (called from game.js)
    setNetworkManager(networkManager) {
        this.networkManager = networkManager;
        console.log('[ServerErrorDisplay] Network manager reference set');
    }
    
    // Forward error to server
    forwardToServer(errorData) {
        if (this.networkManager && this.networkManager.socket && this.networkManager.socket.connected) {
            console.log('[ServerErrorDisplay] Forwarding client error to server:', errorData.type);
            this.networkManager.socket.emit('client-error', errorData);
        } else {
            console.log('[ServerErrorDisplay] Cannot forward to server - no network connection');
        }
    }
    
    // Add a new server error to the display
    addError(errorData) {
        if (!this.errorList) return;
        
        // Remove "No errors" message if present
        if (this.errorList.children.length === 1 && this.errorList.children[0].textContent === 'No server errors...') {
            this.errorList.innerHTML = '';
        }
        
        // Create error element
        const errorElement = document.createElement('div');
        errorElement.style.marginBottom = '4px';
        errorElement.style.padding = '4px';
        errorElement.style.background = 'rgba(255, 0, 0, 0.1)';
        errorElement.style.border = '1px solid rgba(255, 0, 0, 0.2)';
        errorElement.style.borderRadius = '3px';
        
        // Format timestamp
        const timestamp = new Date(errorData.timestamp).toLocaleTimeString();
        
        // Error content
        errorElement.innerHTML = `
            <div style="color: #ff0000; font-weight: bold;">[${errorData.type.toUpperCase()}] ${timestamp}</div>
            <div style="color: #ff6666; word-break: break-all;">${this.escapeHtml(errorData.message)}</div>
        `;
        
        // Add to top of list
        this.errorList.insertBefore(errorElement, this.errorList.firstChild);
        
        // Limit number of errors
        while (this.errorList.children.length > this.maxErrors) {
            this.errorList.removeChild(this.errorList.lastChild);
        }
        
        // Auto-scroll to top to show latest error
        this.errorList.scrollTop = 0;
        
        console.log('[ServerErrorDisplay] Added error:', errorData);
    }
    
    // Clear all errors
    clearErrors() {
        if (!this.errorList) return;
        
        this.errorList.innerHTML = '<div>No server errors...</div>';
        console.log('[ServerErrorDisplay] Cleared all errors');
    }
    
    // Escape HTML to prevent injection
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.serverErrorDisplay = new ServerErrorDisplay();
});
