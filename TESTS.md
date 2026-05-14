# 🧪 Тесты Innotech Kanban

## Frontend тесты (HTML)
- **Файл**: `frontend/test.html`
- **Запуск**: Открыть в браузере
- **Что тестирует**:
  - ✓ Title валидация (пусто, длина, тип)
  - ✓ Description валидация (длина)
  - ✓ Tag валидация (допустимые значения)
  - ✓ Column валидация
  - ✓ Full Task валидация
- **Результаты**: 18/18 ✓ PASS

## Backend тесты (Jest)
- **Файл**: `backend/src/middleware/validate.test.js`
- **Запуск**: `npm test` (в папке backend)
- **Что тестирует**:
  - ✓ Валидная задача проходит
  - ✓ Пустой title вернёт 400
  - ✓ Недопустимый tag вернёт 400
  - ✓ Все валидные tags работают
  - ✓ Все валидные columns работают
  - ✓ Недопустимая column вернёт 400
- **Результаты**: 6/6 ✓ PASS

## Запуск тестов

### Frontend
```bash
# Просто открыть в браузере
frontend/test.html
```

### Backend
```bash
cd backend
npm install
npm test
```

## Все тесты без багов ✅
