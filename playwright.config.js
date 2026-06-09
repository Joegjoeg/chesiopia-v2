// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:3000',
        headless: true,
        viewport: { width: 1280, height: 720 },
        ignoreHTTPSErrors: true,
    },
    projects: [
        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                executablePath: '/usr/bin/firefox',
            },
        },
    ],
    // Assumes `npm run dev` is already running — don't start a new server
    webServer: undefined,
});
