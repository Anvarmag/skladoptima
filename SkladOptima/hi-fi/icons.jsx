// ─── Lucide-style inline SVG icons ──────────────────────────────────────────
// Each icon is a React component: <Icon name size color strokeWidth />

const PATHS = {
  Package:     'M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  BarChart2:   'M18 20V10M12 20V4M6 20v-6',
  PieChart:    'M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z',
  Clock:       'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-14v4l2.5 2.5',
  ShoppingCart:'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  Bell:        'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  Settings:    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8.56-2.83a8.5 8.5 0 0 0 .09-1.17 8.5 8.5 0 0 0-.09-1.17l2.07-1.62c.19-.15.24-.42.12-.64l-1.96-3.39c-.12-.22-.39-.3-.61-.22l-2.44.98a8.86 8.86 0 0 0-2.02-1.17l-.37-2.6A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.37 2.6A8.86 8.86 0 0 0 7.12 6.19l-2.44-.98c-.23-.09-.49 0-.61.22L2.11 8.82c-.13.22-.07.49.12.64l2.07 1.62c-.05.38-.08.77-.08 1.17s.03.79.08 1.17L2.23 15.04c-.19.15-.24.42-.12.64l1.96 3.39c.12.22.39.3.61.22l2.44-.98c.63.45 1.31.81 2.02 1.17l.37 2.6c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.37-2.6a8.86 8.86 0 0 0 2.02-1.17l2.44.98c.23.09.49 0 .61-.22l1.96-3.39c.12-.22.07-.49-.12-.64l-2.07-1.62z',
  TrendingUp:  'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  TrendingDown:'M23 18l-9.5-9.5-5 5L1 6M17 18h6v-6',
  AlertCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',
  Star:        'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  ArrowUp:     'M12 19V5M5 12l7-7 7 7',
  ArrowDown:   'M12 5v14M19 12l-7 7-7-7',
  RefreshCw:   'M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16',
  Search:      'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
  Plus:        'M12 5v14M5 12h14',
  Eye:         'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  EyeOff:      'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22',
  Edit:        'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  Trash2:      'M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  ChevronLeft: 'M15 18l-6-6 6-6',
  ChevronRight:'M9 18l6-6-6-6',
  ChevronDown: 'M6 9l6 6 6-6',
  LogOut:      'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  MessageCircle:'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  Send:        'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  X:           'M18 6 6 18M6 6l12 12',
  Check:       'M20 6 9 17l-5-5',
  Filter:      'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  Download:    'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  Upload:      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  DollarSign:  'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  Zap:         'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  Archive:     'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  Receipt:     'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1zM9 7h6M9 11h6M9 15h4',
  Store:       'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
};

function Icon({ name, size = 18, color = 'currentColor', strokeWidth = 1.75, style }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>
      {d.split('M').filter(Boolean).map((seg, i) => (
        <path key={i} d={'M' + seg} />
      ))}
    </svg>
  );
}

Object.assign(window, { Icon });
