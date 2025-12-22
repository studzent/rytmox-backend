# Промпт для Cursor на сервере

Скопируй этот промпт и используй в Cursor на сервере api.rytmox.ai:

---

## Промпт для диагностики ошибок 502:

```
Проверь и исправь проблемы с 502 Bad Gateway на сервере api.rytmox.ai.

КРИТИЧЕСКИ ВАЖНО - проверить:

1. Статус сервера:
   - pm2 status (запущен ли rytmox-backend?)
   - pm2 logs rytmox-backend --lines 50 (последние ошибки)
   - Если не запущен: cd rytmox-backend && pm2 start index.js --name rytmox-backend

2. Доступность порта 3000:
   - curl http://localhost:3000/ (должен вернуть {"status":"RYTM0X API is running"})
   - netstat -tuln | grep 3000

3. Проверить конкретные проблемные endpoint'ы:
   - curl -X POST http://localhost:3000/auth/anonymous
   - curl -X GET "http://localhost:3000/equipment?environment=home"
   - Если возвращают ошибку - показать полный вывод

4. Проверить логи nginx:
   - sudo tail -50 /var/log/nginx/error.log
   - sudo tail -50 /var/log/nginx/access.log | grep "502"

5. Проверить конфигурацию nginx:
   - sudo nginx -t
   - sudo cat /etc/nginx/sites-available/default | grep -A 30 "api.rytmox.ai"
   - Проверить наличие таймаутов для:
     * /auth/anonymous (должен быть proxy_read_timeout 120s)
     * /equipment (должен быть proxy_read_timeout 60s)
     * /nutrition/analyze-image (должен быть proxy_read_timeout 120s)

6. Если таймауты не настроены, добавить в nginx:
   location /auth/anonymous {
       proxy_read_timeout 120s;
       proxy_connect_timeout 120s;
       proxy_send_timeout 120s;
       proxy_pass http://localhost:3000;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
   }
   
   location /equipment {
       proxy_read_timeout 60s;
       proxy_pass http://localhost:3000;
   }
   
   location /nutrition/analyze-image {
       proxy_read_timeout 120s;
       client_max_body_size 10M;
       proxy_pass http://localhost:3000;
   }

7. Проверить переменные окружения:
   - cd rytmox-backend
   - Проверить наличие .env файла
   - Проверить SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, OPENAI_API_KEY

8. После исправлений:
   - sudo nginx -t
   - sudo systemctl reload nginx
   - pm2 restart rytmox-backend
   - pm2 logs rytmox-backend --lines 20

Покажи результаты всех проверок и исправь найденные проблемы.
```

---

## Промпт для обновления кода:

```
Обновить код бэкенда RYTMOX и настроить nginx для работы транскрибации голосовых сообщений.

Задачи:
1. Обновить код из git (origin/main) в директории rytmox-backend
2. Установить зависимости (npm install)
3. Перезапустить сервер через pm2 (pm2 restart rytmox-backend)
4. Проверить и обновить конфигурацию nginx для поддержки больших запросов:
   - Установить client_max_body_size 50M
   - Установить таймауты 300s для /chat/transcribe
   - Проверить конфигурацию (nginx -t)
   - Перезагрузить nginx (systemctl reload nginx)
5. Проверить логи pm2 и nginx на ошибки
6. Убедиться, что файл services/transcriptionService.js существует
7. Проверить, что переменная окружения OPENAI_API_KEY установлена

Важно: транскрибация требует поддержки запросов до 50MB. Если в nginx нет client_max_body_size 50M, нужно добавить это в конфигурацию для сервера api.rytmox.ai.

Покажи текущую конфигурацию nginx, внеси необходимые изменения и выполни все команды.
```

---

## Альтернативный краткий промпт:

```
Обновить бэкенд RYTMOX на сервере: 
1. git pull origin main в rytmox-backend
2. npm install
3. pm2 restart rytmox-backend
4. Проверить nginx конфигурацию - должен быть client_max_body_size 50M для транскрибации
5. Если нет - добавить и перезагрузить nginx
6. Проверить логи на ошибки

Транскрибация не работает, нужно обновить код и настроить nginx для больших запросов (50MB).
```

---

## Еще более краткий вариант:

```
Обновить код rytmox-backend из git, перезапустить pm2, проверить nginx (client_max_body_size 50M для транскрибации), показать логи.
```

