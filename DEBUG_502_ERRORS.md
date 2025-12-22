# Диагностика ошибок 502 Bad Gateway

## Проблема
Пользователи получают ошибки 502 Bad Gateway при:
- Создании анонимного пользователя (`/auth/anonymous`)
- Загрузке оборудования (`/equipment`)
- Анализе изображений (`/nutrition/analyze-image`)

## Промпт для диагностики на сервере

```
Проверь и исправь проблемы с 502 Bad Gateway на сервере api.rytmox.ai.

Нужно проверить:

1. Статус сервера и процессов:
   - pm2 status (проверить, запущен ли rytmox-backend)
   - pm2 logs rytmox-backend --lines 50 (последние логи)
   - ps aux | grep node (проверить процессы Node.js)

2. Проверить доступность порта 3000:
   - netstat -tuln | grep 3000
   - curl http://localhost:3000/ (должен вернуть статус)

3. Проверить конфигурацию nginx:
   - sudo nginx -t (проверка синтаксиса)
   - sudo cat /etc/nginx/sites-available/default | grep -A 20 "api.rytmox.ai"
   - Проверить таймауты для проблемных роутов:
     * /auth/anonymous
     * /equipment
     * /nutrition/analyze-image

4. Проверить логи nginx:
   - sudo tail -50 /var/log/nginx/error.log
   - sudo tail -50 /var/log/nginx/access.log | grep "502"

5. Проверить конкретные endpoint'ы:
   - curl -X POST http://localhost:3000/auth/anonymous
   - curl -X GET "http://localhost:3000/equipment?environment=home"
   - curl -X GET http://localhost:3000/ (должен вернуть статус API)

6. Если сервер не запущен или упал:
   - cd /path/to/rytmox-backend
   - pm2 restart rytmox-backend
   - или pm2 start index.js --name rytmox-backend

7. Проверить переменные окружения:
   - Проверить наличие .env файла
   - Проверить SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, OPENAI_API_KEY

8. Проверить использование ресурсов:
   - free -h (память)
   - df -h (диск)
   - top или htop (CPU и процессы)

9. Если проблема с таймаутами nginx:
   - Добавить/обновить настройки для проблемных роутов:
     location /auth/anonymous {
       proxy_read_timeout 120s;
       proxy_connect_timeout 120s;
       proxy_send_timeout 120s;
     }
     
     location /equipment {
       proxy_read_timeout 60s;
     }
     
     location /nutrition/analyze-image {
       proxy_read_timeout 120s;
       client_max_body_size 10M;
     }

10. После исправлений:
    - sudo nginx -t
    - sudo systemctl reload nginx
    - pm2 restart rytmox-backend

Покажи результаты всех проверок и исправь найденные проблемы.
```

## Быстрая проверка (одна команда)

```bash
# Проверка статуса и логов
pm2 status && echo "--- PM2 LOGS ---" && pm2 logs rytmox-backend --lines 20 --nostream && echo "--- NGINX ERRORS ---" && sudo tail -20 /var/log/nginx/error.log && echo "--- TEST ENDPOINTS ---" && curl -s http://localhost:3000/ | head -5
```

## Типичные проблемы и решения

### 1. Сервер не запущен
```bash
cd /path/to/rytmox-backend
pm2 start index.js --name rytmox-backend
pm2 save
```

### 2. Таймаут nginx слишком короткий
Добавить в конфигурацию nginx:
```nginx
location /auth/anonymous {
    proxy_read_timeout 120s;
    proxy_pass http://localhost:3000;
}
```

### 3. Сервер упал из-за ошибки
Проверить логи и перезапустить:
```bash
pm2 logs rytmox-backend --err
pm2 restart rytmox-backend
```

### 4. Недостаточно памяти
```bash
# Проверить память
free -h
# Если мало памяти, перезапустить сервер
pm2 restart rytmox-backend
```

### 5. Проблемы с базой данных
Проверить подключение к Supabase:
```bash
# В логах искать ошибки подключения к Supabase
pm2 logs rytmox-backend | grep -i supabase
```

