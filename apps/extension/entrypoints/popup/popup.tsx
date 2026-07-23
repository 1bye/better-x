import {
  type ChangeEventHandler,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  DEFAULT_READER_SETTINGS,
  type ReaderSettings,
  readerSettings,
} from "../../lib/settings";

import "./popup.css";

interface SettingToggleProps {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  name: keyof ReaderSettings;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

const SettingToggle = ({
  checked,
  description,
  disabled = false,
  label,
  name,
  onChange,
}: SettingToggleProps) => (
  <label className="setting">
    <span className="setting__copy">
      <strong>{label}</strong>
      <span>{description}</span>
    </span>
    <span className="switch">
      <input
        checked={checked}
        disabled={disabled}
        name={name}
        onChange={onChange}
        type="checkbox"
      />
      <span aria-hidden="true" className="switch__track" />
    </span>
  </label>
);

function Popup() {
  const [settings, setSettings] = useState<ReaderSettings>(
    DEFAULT_READER_SETTINGS
  );
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const savedSettings = await readerSettings.getValue();
        if (isMounted) {
          setSettings(savedSettings);
          setIsReady(true);
        }
      } catch {
        if (isMounted) {
          setError("Settings could not be loaded.");
        }
      }
    };

    loadSettings();
    const unwatch = readerSettings.watch((updatedSettings) => {
      if (isMounted) {
        setSettings(updatedSettings);
      }
    });

    return () => {
      isMounted = false;
      unwatch();
    };
  }, []);

  const handleSettingChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    async (event) => {
      const key = event.currentTarget.name;
      if (
        key !== "compactFeed" &&
        key !== "enabled" &&
        key !== "followCursor"
      ) {
        return;
      }

      const nextSettings = {
        ...settings,
        [key]: event.currentTarget.checked,
      };
      setSettings(nextSettings);
      setError(null);
      try {
        await readerSettings.setValue(nextSettings);
      } catch {
        setSettings(settings);
        setError("That change could not be saved.");
      }
    },
    [settings]
  );

  return (
    <main className="popup">
      <header className="popup__header">
        <span aria-hidden="true" className="popup__mark">
          BX
        </span>
        <span className="popup__heading">
          <strong>Better X</strong>
          <span>Reader layout</span>
        </span>
        <span
          className={settings.enabled ? "status status--enabled" : "status"}
        >
          {settings.enabled ? "On" : "Off"}
        </span>
      </header>

      <div aria-hidden="true" className="layout-preview">
        <span className="layout-preview__nav" />
        <span className="layout-preview__feed">
          <i />
          <i />
          <i />
        </span>
        <span className="layout-preview__reader">
          <i />
          <i />
        </span>
      </div>

      <section aria-label="Reader settings" className="settings">
        <SettingToggle
          checked={settings.enabled}
          description="Replace the right rail with a post reader."
          disabled={!isReady}
          label="Split view"
          name="enabled"
          onChange={handleSettingChange}
        />
        <SettingToggle
          checked={settings.compactFeed}
          description="Shorter cards make the feed work like a list."
          disabled={!(isReady && settings.enabled)}
          label="Compact feed"
          name="compactFeed"
          onChange={handleSettingChange}
        />
        <SettingToggle
          checked={settings.followCursor}
          description="Preview the post that stays under your pointer."
          disabled={!(isReady && settings.enabled)}
          label="Follow cursor"
          name="followCursor"
          onChange={handleSettingChange}
        />
      </section>

      <footer className="popup__footer">
        {error ? (
          <span className="popup__error" role="status">
            {error}
          </span>
        ) : (
          <span>
            On X, press <kbd>P</kbd> to pin a post.
          </span>
        )}
      </footer>
    </main>
  );
}

export default Popup;
