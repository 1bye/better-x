import {
  type ChangeEventHandler,
  useCallback,
  useEffect,
  useState,
} from "react";
import { DEFAULT_FOCUS_SETTINGS, focusSettings } from "../lib/settings";

interface FocusSettingsControl {
  readonly enabled: boolean;
  readonly error: string | null;
  readonly isReady: boolean;
  readonly onEnabledChange: ChangeEventHandler<HTMLInputElement>;
}

export const useFocusSettings = (): FocusSettingsControl => {
  const [enabled, setEnabled] = useState(DEFAULT_FOCUS_SETTINGS.enabled);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

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
    const unwatch = focusSettings.watch((settings) => {
      if (isMounted) {
        setEnabled(settings.enabled);
      }
    });
    loadSettings();

    return () => {
      isMounted = false;
      unwatch();
    };
  }, []);

  const onEnabledChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
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

  return { enabled, error, isReady, onEnabledChange };
};
