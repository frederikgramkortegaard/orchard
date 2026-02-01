import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'pink';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setPinkMode: (enabled: boolean) => void;
  isPink: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'orchard-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'pink') {
        return stored;
      }
    }
    return 'dark'; // Default to dark
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'pink');
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'pink') {
      root.classList.add('pink');
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      if (prev === 'pink') return 'dark';
      return prev === 'dark' ? 'light' : 'dark';
    });
  };

  const setPinkMode = (enabled: boolean) => {
    setTheme(enabled ? 'pink' : 'dark');
  };

  const isPink = theme === 'pink';

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setPinkMode, isPink }}>
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
