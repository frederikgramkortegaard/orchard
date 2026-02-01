import { X, Sun, Moon, Monitor, RotateCcw } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import {
  useSettingsStore,
  TIMEZONE_OPTIONS,
  getEffectiveTimezone,
  type ThemePreference,
  type TimeFormat,
} from '../../stores/settings.store';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { themePreference, setThemePreference } = useTheme();
  const {
    timezone,
    timeFormat,
    enableNotifications,
    notificationSound,
    compactMode,
    showTimestamps,
    setTimezone,
    setTimeFormat,
    setEnableNotifications,
    setNotificationSound,
    setCompactMode,
    setShowTimestamps,
    resetToDefaults,
  } = useSettingsStore();

  if (!isOpen) return null;

  const themeOptions: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={16} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={16} /> },
    { value: 'system', label: 'System', icon: <Monitor size={16} /> },
  ];

  const timeFormatOptions: { value: TimeFormat; label: string }[] = [
    { value: '12h', label: '12-hour (2:30 PM)' },
    { value: '24h', label: '24-hour (14:30)' },
  ];

  // Get current time preview in selected timezone
  const getTimePreview = () => {
    const now = new Date();
    const effectiveTimezone = getEffectiveTimezone(timezone);
    try {
      return now.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: timeFormat === '12h',
        timeZone: effectiveTimezone,
      });
    } catch {
      return now.toLocaleTimeString();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-800 rounded-lg w-full max-w-lg mx-4 shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Appearance Section */}
          <section>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Appearance
            </h3>

            {/* Theme */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">Theme</label>
              <div className="flex gap-2">
                {themeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setThemePreference(option.value)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded transition-colors ${
                      themePreference === option.value
                        ? 'bg-green-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                    }`}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Compact Mode */}
            <div className="flex items-center justify-between mt-4">
              <div>
                <label className="block text-sm font-medium">Compact Mode</label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Reduce spacing in the interface
                </p>
              </div>
              <ToggleSwitch
                checked={compactMode}
                onChange={setCompactMode}
              />
            </div>
          </section>

          {/* Time & Date Section */}
          <section>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Time & Date
            </h3>

            {/* Timezone */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:border-green-500"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Current time: {getTimePreview()}
              </p>
            </div>

            {/* Time Format */}
            <div className="space-y-2 mt-4">
              <label className="block text-sm font-medium">Time Format</label>
              <div className="flex gap-2">
                {timeFormatOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setTimeFormat(option.value)}
                    className={`flex-1 px-3 py-2 rounded text-sm transition-colors ${
                      timeFormat === option.value
                        ? 'bg-green-600 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Show Timestamps */}
            <div className="flex items-center justify-between mt-4">
              <div>
                <label className="block text-sm font-medium">Show Timestamps</label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Display timestamps on messages
                </p>
              </div>
              <ToggleSwitch
                checked={showTimestamps}
                onChange={setShowTimestamps}
              />
            </div>
          </section>

          {/* Notifications Section */}
          <section>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Notifications
            </h3>

            {/* Enable Notifications */}
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium">Enable Notifications</label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Show desktop notifications for updates
                </p>
              </div>
              <ToggleSwitch
                checked={enableNotifications}
                onChange={setEnableNotifications}
              />
            </div>

            {/* Notification Sound */}
            <div className="flex items-center justify-between mt-4">
              <div>
                <label className="block text-sm font-medium">Notification Sound</label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Play sound for notifications
                </p>
              </div>
              <ToggleSwitch
                checked={notificationSound}
                onChange={setNotificationSound}
                disabled={!enableNotifications}
              />
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 flex-shrink-0">
          <button
            onClick={resetToDefaults}
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            <RotateCcw size={16} />
            Reset to Defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-red-600 hover:bg-green-500 text-white rounded"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Toggle Switch Component
function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer'
      } ${
        checked
          ? 'bg-red-600'
          : 'bg-zinc-300 dark:bg-zinc-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
