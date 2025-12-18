#!/bin/bash

# Скрипт деплоя RYTM0X Backend
# Использование: ./deploy.sh

set -e  # Остановить при ошибке

echo "🚀 Начинаем деплой RYTM0X Backend..."

# Получить последние изменения
echo "📥 Получаем последние изменения из git..."
git fetch origin

# Проверить текущую ветку
CURRENT_BRANCH=$(git branch --show-current)
echo "📍 Текущая ветка: $CURRENT_BRANCH"

# Сбросить локальные изменения и перейти на актуальный main
echo "🔄 Обновляем код до последней версии main..."
git reset --hard origin/main

# Показать последний коммит
echo "📝 Последний коммит:"
git log -1 --oneline

# Проверить, что node_modules установлены
if [ ! -d "node_modules" ]; then
    echo "📦 Устанавливаем зависимости..."
    npm install
else
    echo "✅ node_modules уже установлены"
fi

# Перезапустить сервер через pm2
echo "🔄 Перезапускаем сервер через pm2..."
if pm2 list | grep -q "rytmox-backend"; then
    pm2 restart rytmox-backend
    echo "✅ Сервер перезапущен через pm2"
else
    echo "⚠️  Процесс rytmox-backend не найден в pm2"
    echo "💡 Попробуйте запустить: pm2 start index.js --name rytmox-backend"
fi

# Показать логи
echo "📋 Последние логи сервера:"
pm2 logs rytmox-backend --lines 20 --nostream

echo "✅ Деплой завершён!"
echo ""
echo "🧪 Проверьте работу API:"
echo "   curl -X GET https://api.rytmox.ai/"
echo "   curl -X POST https://api.rytmox.ai/chat/send -H 'Content-Type: application/json' -d '{\"userId\":\"test\",\"mode\":\"team\",\"text\":\"Hello\"}'"

