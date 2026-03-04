# Фронтенд — Sklad Optima

> **Стек:** React 19, Vite 7, Tailwind CSS 4, React Router 7, Axios, Lucide React  
> **Расположение:** `apps/web/`

---

## Структура папок

```
apps/web/src/
├── context/
│   └── AuthContext.tsx    # Глобальный стейт авторизации (user, loading)
├── layouts/
│   └── MainLayout.tsx     # Боковая панель + header (для /app/*)
├── pages/
│   ├── Login.tsx          # Форма входа, POST /api/auth/login
│   ├── Products.tsx       # ГЛАВНАЯ СТРАНИЦА: Таблица товаров, CRUD
│   ├── History.tsx        # Таблица логов (audit)
│   ├── Orders.tsx         # Таблица обработанных заказов МП
│   └── Settings.tsx       # Настройки API ключей WB/Ozon
├── App.tsx                # Роутинг (Routes), PrivateRoute
└── main.tsx               # Entry point, AuthProvider
```

---

## Роутинг (`App.tsx`)

| Path | Описание | Guard |
|------|----------|-------|
| `/` | Redirect на `/login` | Public |
| `/login` | Страница логина | Public |
| `/app` | Редирект на `/app/products` | **PrivateRoute** |
| `/app/products` | Список товаров | **PrivateRoute** |
| `/app/history` | Аудит-лог | **PrivateRoute** |
| `/app/orders` | Заказы | **PrivateRoute** |
| `/app/settings` | Настройки ключей | **PrivateRoute** |

**`PrivateRoute` логика:** Из `AuthContext` берётся флаг `loading` (пока идёт `/auth/me`). Если юзера нет — редирект на `/login`.

---

## Авторизация (`AuthContext.tsx`)

- При монтировании: `checkAuth()` → `GET /api/auth/me`.
- Успех: устанавливает `user { id, email }`.
- Ошибка: `user = null`, редирект на `/login`.
- **Axios Configuration**:
  ```typescript
  axios.defaults.withCredentials = true; // Отправляем/принимаем httpOnly cookies
  axios.defaults.baseURL = import.meta.env.VITE_API_URL || '/api';
  ```

---

## Основные компоненты

### 1. `MainLayout.tsx`
- Обертка для всех страниц внутри `/app/`.
- Содержит адаптивный Sidebar:
  - Desktop: всегда видимый блок слева (64 tailwind units).
  - Mobile: скрыт за гамбургером, выезжает.
- Кнопка "Выйти" вызывает `POST /api/auth/logout` и переводит на `/login`.

### 2. `Products.tsx`
Самая большая и сложная страница (~600 строк).

**State:**
- `products`: массив объектов товаров.
- `search`: строковый поиск (с debounce 300ms на API).
- `page`, `totalPages`: пагинация таблиц (по 20 шт).
- `isAddModalOpen`: модалка создания/редактирования формы (`multipart/form-data`).

**Inline-редактирование остатков:**
- Пользователь кликает на ячейку `available`, `WB Fbs` или `Ozon Fbs`.
- Появляется input `<input type="number" ... />`.
- При **blur** (или Enter): отправляется `POST /api/products/${id}/stock-adjust` (для total) или `PUT /api/products/${id}` (для ручных WB/Ozon).
- В таблице **оптимистично** обновляется значение, чтобы не ждать ответа API.

**Особенности:**
- Картиночка `product.photo` рендерится через `API_URL${product.photo}` (в dev это `/uploads/123.jpg`, проксируется Vite).
- Auto-refresh: Каждые 30 секунд идёт `fetchProducts()` чтобы показать изменения с маркетплейсов.

### 3. `Settings.tsx`
- Получает 5 API ключей в форму (`ozonClientId`, `ozonApiKey`, `ozonWarehouseId`, `wbApiKey`, `wbWarehouseId`).
- Сохраняет `PUT /api/settings/marketplaces`.
- Две кнопки `"Проверить"`, которые дергают `POST /api/sync/test/{wb|ozon}` и показывают Toast ("Связь успешна" / "Ошибка").

---

## Взаимодействие с API

Фронтенд не хранит ключи (только JWT в cookie). Все запросы идут через прокси Vite (в деве):
`vite.config.ts`:
```typescript
server: {
  proxy: {
    '/api':     { target: 'http://localhost:3000', changeOrigin: true },
    '/uploads': { target: 'http://localhost:3000', changeOrigin: true } // Для картинок
  }
}
```

В Production проксированием занимается NGINX.
