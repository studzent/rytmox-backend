# Инструкция по обновлению транскрибации на сервере

## Проблема
Транскрибация голосовых сообщений не работает или работает не полностью.

## Что нужно сделать на сервере

### 1. Обновить код бэкенда

```bash
# Подключиться к серверу
ssh user@api.rytmox.ai

# Перейти в директорию проекта
cd /path/to/rytmox-backend

# Получить последние изменения
git fetch origin
git reset --hard origin/main

# Убедиться, что зависимости установлены
npm install

# Перезапустить сервер через pm2
pm2 restart rytmox-backend

# Проверить логи
pm2 logs rytmox-backend --lines 50
```

### 2. Проверить конфигурацию Nginx

Транскрибация требует поддержки больших запросов (до 50MB). Нужно убедиться, что nginx настроен правильно:

```bash
# Найти конфигурацию nginx
sudo find /etc/nginx -name "*.conf" | xargs grep -l "api.rytmox.ai"

# Проверить текущую конфигурацию
sudo cat /etc/nginx/sites-available/default
# или
sudo cat /etc/nginx/sites-available/api.rytmox.ai
```

**Важно:** В конфигурации nginx должны быть следующие настройки:

```nginx
server {
    listen 80;
    server_name api.rytmox.ai;
    
    # Глобальный лимит для всего сервера
    client_max_body_size 50M;
    client_body_timeout 300s;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    
    # Специфичные настройки для транскрибации
    location /chat/transcribe {
        client_max_body_size 50M;
        client_body_timeout 300s;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        
        # Отключаем буферизацию для больших запросов
        proxy_request_buffering off;
        proxy_buffering off;
        
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Остальные роуты
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Применить изменения в nginx

```bash
# Проверить конфигурацию на ошибки
sudo nginx -t

# Если проверка прошла успешно, перезагрузить nginx
sudo systemctl reload nginx

# Проверить логи на ошибки
sudo tail -f /var/log/nginx/error.log
```

### 4. Проверить работу транскрибации

```bash
# Тестовый запрос (замените YOUR_USER_ID и YOUR_BASE64_AUDIO)
curl -X POST https://api.rytmox.ai/chat/transcribe \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "userId": "YOUR_USER_ID",
    "audioBase64": "YOUR_BASE64_AUDIO",
    "mimeType": "audio/m4a",
    "language": "ru"
  }'
```

### 5. Проверить логи бэкенда

```bash
# Смотреть логи в реальном времени
pm2 logs rytmox-backend --lines 0

# Или проверить последние логи
pm2 logs rytmox-backend --lines 100
```

## Возможные проблемы и решения

### Проблема: Ошибка 413 (Request Entity Too Large)
**Решение:** Увеличить `client_max_body_size` в nginx до 50M

### Проблема: Таймаут при транскрибации
**Решение:** Увеличить таймауты в nginx (`proxy_read_timeout`, `client_body_timeout`)

### Проблема: Транскрибация возвращает пустой результат
**Решение:** 
- Проверить логи бэкенда на ошибки OpenAI API
- Проверить, что OPENAI_API_KEY установлен в переменных окружения
- Проверить размер файла (должен быть < 25MB после декодирования base64)

### Проблема: "recorder not prepared" на клиенте
**Решение:** Это клиентская проблема в Expo, требует перезапуска приложения

## Файлы, которые должны быть на сервере

- `services/transcriptionService.js` - сервис транскрибации
- `controllers/chatController.js` - контроллер с методом `transcribeAudio`
- `routes/chat.js` - роут `/chat/transcribe` с увеличенным лимитом body
- `index.js` - глобальный лимит body до 50MB

## Проверка версии кода

```bash
# На сервере проверить последний коммит
cd /path/to/rytmox-backend
git log -1 --oneline

# Должен быть коммит с транскрибацией:
# "Fix 413 error: increase body size limits and improve transcription quality"
```

