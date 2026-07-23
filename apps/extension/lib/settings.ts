import { storage } from "wxt/utils/storage";

export interface ReaderSettings {
  compactFeed: boolean;
  enabled: boolean;
  followCursor: boolean;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  compactFeed: true,
  enabled: true,
  followCursor: true,
};

export const readerSettings = storage.defineItem<ReaderSettings>(
  "local:reader-settings",
  {
    fallback: DEFAULT_READER_SETTINGS,
  }
);
