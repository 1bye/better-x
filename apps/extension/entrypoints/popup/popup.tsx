import {
  type ChangeEventHandler,
  useCallback,
  useEffect,
  useState,
} from "react";

import { DEFAULT_FOCUS_SETTINGS, focusSettings } from "../../lib/settings";

import "./popup.css";

const SHORTCUTS = [
  { keys: ["⇧", "F"], label: "Focus" },
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["L"], label: "Like" },
  { keys: ["R"], label: "Reply" },
  { keys: ["↵"], label: "Open" },
] as const;

function Popup() {
  const [enabled, setEnabled] = useState(DEFAULT_FOCUS_SETTINGS.enabled);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async (): Promise<void> => {
      try {
        const settings = await focusSettings.getValue();
        if (isMounted) {
          setEnabled(settings.enabled);
          setIsReady(true);
        }
      } catch {
        if (isMounted) {
          setError("Focus Mode settings could not be loaded.");
        }
      }
    };

    loadSettings();
    const unwatch = focusSettings.watch((settings) => {
      if (isMounted) {
        setEnabled(settings.enabled);
      }
    });

    return () => {
      isMounted = false;
      unwatch();
    };
  }, []);

  const handleEnabledChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    async (event) => {
      const previousEnabled = enabled;
      const nextEnabled = event.currentTarget.checked;
      setEnabled(nextEnabled);
      setError(null);

      try {
        await focusSettings.setValue({ enabled: nextEnabled });
      } catch {
        setEnabled(previousEnabled);
        setError("That change could not be saved.");
      }
    },
    [enabled]
  );

  return (
    <main className="popup">
      <header className="popup__header">
        <span aria-hidden="true" className="popup__mark">
          BX
        </span>
        <span className="popup__heading">
          <strong>Better X</strong>
          <span>Keyboard focus for X</span>
        </span>
        <span className={enabled ? "status status--enabled" : "status"}>
          {enabled ? "Ready" : "Off"}
        </span>
      </header>

      <div aria-hidden="true" className="focus-preview">
        <span className="focus-preview__nav" />
        <span className="focus-preview__page">
          <i />
          <i className="focus-preview__post" />
          <i />
        </span>
        <span className="focus-preview__shade" />
        <span className="focus-preview__spotlight" />
        <span className="focus-preview__toolbar">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>

      <label className="setting">
        <span className="setting__copy">
          <strong>Enable Focus Mode</strong>
          <span>Press Shift + F on X to spotlight the nearest post.</span>
        </span>
        <span className="switch">
          <input
            checked={enabled}
            disabled={!isReady}
            onChange={handleEnabledChange}
            type="checkbox"
          />
          <span aria-hidden="true" className="switch__track" />
        </span>
      </label>

      <section aria-label="Focus Mode shortcuts" className="shortcuts">
        {SHORTCUTS.map((shortcut) => (
          <span className="shortcut" key={shortcut.label}>
            <span className="shortcut__keys">
              {shortcut.keys.map((key) => (
                <kbd data-name="Kbd" data-slot="kbd" key={key}>
                  {key}
                </kbd>
              ))}
            </span>
            <span>{shortcut.label}</span>
          </span>
        ))}
      </section>

      <footer className="popup__footer">
        {error ? (
          <span className="popup__error" role="status">
            {error}
          </span>
        ) : (
          <span>Press Escape at any time to return to the normal page.</span>
        )}
      </footer>
    </main>
  );
}

export default Popup;
