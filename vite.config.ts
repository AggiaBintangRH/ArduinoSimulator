import { defineConfig } from 'vite';
import { arduinoCompilePlugin } from './vite-plugins/arduino-compile.js';

export default defineConfig({
  plugins: [arduinoCompilePlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
