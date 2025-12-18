# Конфигурация Nginx для поддержки больших файлов транскрибации

## Проблема
Ошибка 413 (Request Entity Too Large) возникает, когда nginx отклоняет запросы больше определенного размера, даже если Express настроен на прием больших файлов.

## Решение

Добавьте или обновите следующие директивы в конфигурации nginx для вашего сервера:

### Для основного сервера (обычно `/etc/nginx/nginx.conf` или `/etc/nginx/sites-available/default`):

```nginx
http {
    # Увеличиваем лимит размера body для всех запросов
    client_max_body_size 50M;
    
    # Увеличиваем таймауты для больших запросов
    client_body_timeout 300s;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    
    # Буферизация для больших запросов
    client_body_buffer_size 128k;
    proxy_buffering on;
    proxy_buffer_size 4k;
    proxy_buffers 8 4k;
    proxy_busy_buffers_size 8k;
    
    server {
        listen 80;
        server_name api.rytmox.ai;
        
        # Специфичные настройки для роута транскрибации
        location /chat/transcribe {
            client_max_body_size 50M;
            client_body_timeout 300s;
            proxy_read_timeout 300s;
            
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
        
        # Остальные роуты
        location / {
            client_max_body_size 10M;  # Меньший лимит для обычных запросов
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

## После изменения конфигурации

1. Проверьте конфигурацию на ошибки:
   ```bash
   sudo nginx -t
   ```

2. Перезагрузите nginx:
   ```bash
   sudo systemctl reload nginx
   # или
   sudo service nginx reload
   ```

3. Проверьте логи nginx для диагностики:
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

## Альтернативное решение (если нет доступа к nginx)

Если у вас нет доступа к конфигурации nginx (например, используете хостинг без root-доступа), можно:

1. Использовать прямой доступ к Express (если порт открыт)
2. Обратиться к администратору хостинга для увеличения лимита
3. Использовать chunked upload для больших файлов (требует изменений в коде)

## Проверка

После применения изменений проверьте:

```bash
# Проверка размера запроса, который может обработать сервер
curl -X POST https://api.rytmox.ai/chat/transcribe \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}' \
  -v
```

Если ошибка 413 все еще возникает, проверьте:
- Логи nginx: `sudo tail -f /var/log/nginx/error.log`
- Логи Express: `pm2 logs rytmox-backend`
- Размер фактического запроса в логах контроллера

