# Skladoptima

Warehouse management system built with Vite + React.

## Features
- **Stocks Management**: Import/Export Excel, view and edit stock levels.
- **Multi-warehouse**: Toggle WB and Ozon warehouse columns.
- **Settings**: Manage view preferences and data.
- **Auth**: Simple local authentication (no backend required).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start development server:
   ```bash
   npm run dev
   ```

3. Login credentials:
   - Email: any non-empty string
   - Password: any non-empty string

## Project Structure
- `src/components`: UI and Layout components
- `src/pages`: Main route components
- `src/store`: State management (Zustand)
- `src/utils`: Helpers (Excel parsing, etc)
