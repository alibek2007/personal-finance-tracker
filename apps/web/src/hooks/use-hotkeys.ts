import { useEffect } from 'react';

export interface Hotkey {
  /** Single character key, lowercase. */
  key: string;
  /** Require Ctrl (Windows/Linux) or Cmd (macOS). When false, any modifier cancels the shortcut. */
  mod?: boolean;
  handler: (event: KeyboardEvent) => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Global shortcuts that never fire while the user is typing in a field. */
export function useHotkeys(hotkeys: Hotkey[]) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      for (const hotkey of hotkeys) {
        if (event.key.toLowerCase() !== hotkey.key) continue;
        const hasMod = event.metaKey || event.ctrlKey;
        if (hotkey.mod) {
          if (!hasMod) continue;
        } else if (hasMod || event.altKey || isTyping(event.target)) {
          continue;
        }
        event.preventDefault();
        hotkey.handler(event);
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkeys]);
}
