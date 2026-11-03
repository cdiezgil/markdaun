import { defineConfig, devices } from '@playwright/test';

const launchOptions = {
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
};

// Both profiles run on Chromium (WebKit is not installed); only viewport/UA differ.
const chromiumPhone = (name: 'Pixel 7' | 'iPhone 13') => {
  const { defaultBrowserType: _ignored, ...device } = devices[name];
  void _ignored;
  return { ...device, launchOptions, permissions: ['microphone'] };
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'block', // the SW would intercept requests and break routing in tests
    browserName: 'chromium',
  },
  projects: [
    { name: 'pixel-7', use: chromiumPhone('Pixel 7') },
    { name: 'iphone-13', use: chromiumPhone('iPhone 13') },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/markdaun/',
    reuseExistingServer: !process.env.CI,
  },
});
