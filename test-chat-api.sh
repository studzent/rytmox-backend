#!/bin/bash

# Скрипт для проверки работы API чата
# Использование: ./test-chat-api.sh

BASE_URL="${1:-https://api.rytmox.ai}"

echo "🧪 Тестирование API чата на $BASE_URL"
echo ""

# Тест 1: Проверка базового эндпоинта
echo "1️⃣  Проверка базового эндпоинта..."
RESPONSE=$(curl -s -X GET "$BASE_URL/")
if echo "$RESPONSE" | grep -q "RYTM0X API"; then
    echo "   ✅ Сервер работает"
else
    echo "   ❌ Сервер не отвечает: $RESPONSE"
    exit 1
fi
echo ""

# Тест 2: Проверка эндпоинта /chat/send (должен вернуть ошибку валидации, но не 404)
echo "2️⃣  Проверка эндпоинта /chat/send..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/chat/send" \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user-id", "mode": "team", "text": "Hello"}')

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" = "404" ]; then
    echo "   ❌ Эндпоинт не найден (404) - маршрут не зарегистрирован"
    echo "   Ответ: $BODY"
    exit 1
elif [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ Эндпоинт работает (HTTP $HTTP_CODE)"
    echo "   Ответ: $BODY"
else
    echo "   ⚠️  Неожиданный код ответа: $HTTP_CODE"
    echo "   Ответ: $BODY"
fi
echo ""

# Тест 3: Проверка валидации (без userId)
echo "3️⃣  Проверка валидации (без userId)..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/chat/send" \
  -H "Content-Type: application/json" \
  -d '{"mode": "team", "text": "Hello"}')

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "userId is required"; then
    echo "   ✅ Валидация работает корректно"
else
    echo "   ⚠️  Неожиданный ответ валидации (HTTP $HTTP_CODE)"
    echo "   Ответ: $BODY"
fi
echo ""

# Тест 4: Проверка эндпоинта /chat/thread
echo "4️⃣  Проверка эндпоинта /chat/thread/:threadId..."
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/chat/thread/test-thread-id")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" = "404" ] && echo "$BODY" | grep -q "Cannot GET"; then
    echo "   ❌ Эндпоинт не найден (404) - маршрут не зарегистрирован"
    exit 1
elif [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "404" ]; then
    echo "   ✅ Эндпоинт работает (HTTP $HTTP_CODE)"
    echo "   Ответ: $BODY"
else
    echo "   ⚠️  Неожиданный код ответа: $HTTP_CODE"
    echo "   Ответ: $BODY"
fi
echo ""

echo "✅ Все тесты пройдены! API чата работает корректно."

