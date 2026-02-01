import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';
export type TimeFormat = '12h' | '24h';

export interface SettingsState {
  // Appearance
  themePreference: ThemePreference;

  // Time & Date
  timezone: string; // IANA timezone string (e.g., 'America/New_York') or 'auto'
  timeFormat: TimeFormat;

  // Notifications
  enableNotifications: boolean;
  notificationSound: boolean;

  // Display
  compactMode: boolean;
  showTimestamps: boolean;

  // Audio
  autoReadMessages: boolean;

  // Actions
  setThemePreference: (preference: ThemePreference) => void;
  setTimezone: (timezone: string) => void;
  setTimeFormat: (format: TimeFormat) => void;
  setEnableNotifications: (enabled: boolean) => void;
  setNotificationSound: (enabled: boolean) => void;
  setCompactMode: (enabled: boolean) => void;
  setShowTimestamps: (enabled: boolean) => void;
  setAutoReadMessages: (enabled: boolean) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  themePreference: 'dark' as ThemePreference,
  timezone: 'auto',
  timeFormat: '12h' as TimeFormat,
  enableNotifications: true,
  notificationSound: false,
  compactMode: false,
  showTimestamps: true,
  autoReadMessages: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setThemePreference: (themePreference) => set({ themePreference }),
      setTimezone: (timezone) => set({ timezone }),
      setTimeFormat: (timeFormat) => set({ timeFormat }),
      setEnableNotifications: (enableNotifications) => set({ enableNotifications }),
      setNotificationSound: (notificationSound) => set({ notificationSound }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setShowTimestamps: (showTimestamps) => set({ showTimestamps }),
      setAutoReadMessages: (autoReadMessages) => set({ autoReadMessages }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'orchard-settings',
      partialize: (state) => ({
        themePreference: state.themePreference,
        timezone: state.timezone,
        timeFormat: state.timeFormat,
        enableNotifications: state.enableNotifications,
        notificationSound: state.notificationSound,
        compactMode: state.compactMode,
        showTimestamps: state.showTimestamps,
        autoReadMessages: state.autoReadMessages,
      }),
    }
  )
);

// Helper function to get the effective timezone
export function getEffectiveTimezone(timezone: string): string {
  if (timezone === 'auto') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return timezone;
}

// Helper function to format time with settings
export function formatTimeWithSettings(
  timestamp: string | Date,
  settings: Pick<SettingsState, 'timezone' | 'timeFormat'>
): string {
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const effectiveTimezone = getEffectiveTimezone(settings.timezone);

    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: settings.timeFormat === '12h',
      timeZone: effectiveTimezone,
    });
  } catch {
    return typeof timestamp === 'string' ? timestamp : timestamp.toISOString();
  }
}

// Helper function to format date with settings
export function formatDateWithSettings(
  timestamp: string | Date,
  settings: Pick<SettingsState, 'timezone'>
): string {
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const effectiveTimezone = getEffectiveTimezone(settings.timezone);

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: effectiveTimezone,
    });
  } catch {
    return typeof timestamp === 'string' ? timestamp : timestamp.toISOString();
  }
}

// Common timezone options
export const TIMEZONE_OPTIONS = [
  { value: 'auto', label: 'Auto-detect (System)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern Time (US)' },
  { value: 'America/Chicago', label: 'Central Time (US)' },
  { value: 'America/Denver', label: 'Mountain Time (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { value: 'America/Anchorage', label: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central European Time' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time' },
  { value: 'Asia/Shanghai', label: 'China Standard Time' },
  { value: 'Asia/Kolkata', label: 'India Standard Time' },
  { value: 'Asia/Singapore', label: 'Singapore Time' },
  { value: 'Australia/Sydney', label: 'Australian Eastern Time' },
  { value: 'Pacific/Auckland', label: 'New Zealand Time' },
];
