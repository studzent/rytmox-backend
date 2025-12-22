# Конфигурация Nginx для анализа изображений питания

## Проблема
Ошибка 502 Bad Gateway при анализе изображений через `/nutrition/analyze-image` возникает из-за таймаута nginx. Анализ изображений через OpenAI Vision API может занимать до 90 секунд.

## Решение

Добавьте специальную настройку для роута `/nutrition/analyze-image` в конфигурации nginx:

```nginx
server {
    listen 80;
    server_name api.rytmox.ai;
    
    # Специфичные настройки для анализа изображений питания
    location /nutrition/analyze-image {
        client_max_body_size 10M;  # Размер изображения в base64
        client_body_timeout 120s;
        proxy_read_timeout 120s;   # Увеличенный таймаут для анализа изображений
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Остальные роуты
    location / {
        client_max_body_size 10M;
        proxy_read_timeout 60s;  # Стандартный таймаут для других запросов
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
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
   ```

3. Проверьте логи nginx для диагностики:
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

## Примечания

- Таймаут в коде (90 секунд) должен быть меньше таймаута nginx (120 секунд)
- Если изображения очень большие, можно добавить сжатие на клиенте перед отправкой
- Для production рекомендуется использовать CDN для изображений

