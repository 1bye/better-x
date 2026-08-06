import { useFocusSettings } from "../hooks/use-focus-settings";

import "../styles/focus-mode-popup.css";

const SHORTCUTS = [
  { keys: ["⇧", "F"], label: "Focus" },
  { keys: ["↑", "↓"], label: "Navigate" },
  { keys: ["L"], label: "Like" },
  { keys: ["R"], label: "Reply" },
  { keys: ["↵"], label: "Open" },
] as const;

export function FocusModePopup() {
  const { enabled, error, isReady, onEnabledChange } = useFocusSettings();

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
            onChange={onEnabledChange}
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
