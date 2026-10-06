import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The dashboard is lazy-loaded; its first import compiles the charting library, which can exceed the 1s default.
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => cleanup());

// jsdom lacks these browser APIs, which cmdk and Radix rely on.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => undefined;

// jsdom's File/Blob may lack text(); import reads files with it.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
