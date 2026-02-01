import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSettingsStore, type ThemePreference } from '../stores/settings.store';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): Theme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function getEffectiveTheme(preference: ThemePreference): Theme {
  if (preference === 'system') {
    return getSystemTheme();
  }
  return preference;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { themePreference, setThemePreference } = useSettingsStore();
  const [theme, setTheme] = useState<Theme>(() => getEffectiveTheme(themePreference));

  // Listen for system theme changes when preference is 'system'
  useEffect(() => {
    if (themePreference !== 'system') {
      setTheme(themePreference);
      return;
    }

    // Set initial system theme
    setTheme(getSystemTheme());

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themePreference]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
    if (theme === 'dark') {
      root.classList.add('dark');
    }
  }, [theme]);

  // Toggle between light/dark (cycles: dark -> light -> dark)
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setThemePreference(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, themePreference, setThemePreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
