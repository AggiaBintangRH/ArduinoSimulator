import { defineConfig } from 'vite';
import { arduinoCompilePlugin } from './vite-plugins/arduino-compile.js';
import { arduinoLibrariesPlugin } from './vite-plugins/arduino-libraries.js';

export default defineConfig({
  plugins: [arduinoCompilePlugin(), arduinoLibrariesPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
