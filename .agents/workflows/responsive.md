---
description: How to ensure all new UI features have responsive/adaptive design
---

# Responsive Design Workflow

All new UI features in Sklad Optima **must** be responsive across mobile (375px), tablet (768px), and desktop (1920px).

## Tailwind Breakpoint System

| Prefix | Min-width | Device          |
|--------|-----------|-----------------|
| (none) | 0px       | Mobile (default)|
| `sm:`  | 640px     | Small tablet    |
| `md:`  | 768px     | Tablet          |
| `lg:`  | 1024px    | Desktop         |
| `xl:`  | 1280px    | Wide desktop    |

## Rules

1. **Mobile-First**: Always write styles for mobile first, then add `sm:`, `md:`, `lg:` overrides.
2. **Tables**: Use `hidden sm:table-cell` or `hidden md:table-cell` to hide less important columns on mobile. Show essential data inline in visible columns instead.
3. **Images**: Never use fixed `px` sizes. Use responsive Tailwind classes like `w-16 h-16 sm:w-28 sm:h-28 lg:w-48 lg:h-48`.
4. **Padding**: Use `px-2 sm:px-4 lg:px-6` pattern for content padding.
5. **Typography**: Use `text-xs sm:text-sm` or `text-xl sm:text-2xl` for responsive text sizing.
6. **Buttons**: Use `flex-wrap` for button groups. Use `flex-col sm:flex-row` for stacked-to-horizontal layouts.
7. **Bottom Navigation**: Mobile has a bottom tab bar (60px height). Add `pb-20 md:pb-8` to main content area.
8. **Modals**: Always use `max-w-md` or `max-w-sm` with `p-4` for proper mobile rendering.
9. **Sidebar**: Hidden on mobile (`hidden md:flex`). Navigation via bottom tab bar instead.
10. **Date/Filter Inputs**: Use `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` for filter layouts.

## Mobile Navigation Scaling Strategy

| Кол-во разделов | Стратегия |
|-----------------|-----------|
| **до 5**        | Все вкладки в bottom nav — всё помещается |
| **6+**          | Последняя вкладка → **«Ещё» (`MoreHorizontal`)**, открывает список остальных разделов |

При 6+ разделах: основные 3 вкладки + «Ещё» (⋯) → sheet/popup с остальными.
Альтернатива: группировка похожих разделов (например, «Заказы» + «Возвраты» = один раздел с внутренними табами).

## Testing Checklist

Before submitting any UI change:
- [ ] Test at 375px width (iPhone SE)
- [ ] Test at 768px width (iPad)
- [ ] Test at 1920px width (Desktop)
- [ ] Ensure no horizontal scrolling on mobile (except for tables with `overflow-x-auto`)
- [ ] Verify bottom nav doesn't overlap content
- [ ] Check all modals are scrollable on small screens
