# Промпт для настройки сервера (Cursor/SSH)

## Задача
Настроить nginx на сервере для поддержки больших файлов транскрибации (до 50MB). Сейчас возникает ошибка 413 (Request Entity Too Large) при отправке голосовых сообщений.

## Промпт для выполнения на сервере:

```
На сервере api.rytmox.ai нужно настроить nginx для поддержки больших запросов (до 50MB) для роута /chat/transcribe.

Текущая проблема: ошибка 413 при отправке голосовых сообщений через API.

Нужно:
1. Найти конфигурационный файл nginx для api.rytmox.ai
2. Добавить или обновить директиву client_max_body_size до 50M
3. Для роута /chat/transcribe установить увеличенные таймауты (300s)
4. Проверить конфигурацию на ошибки
5. Перезагрузить nginx

Файл конфигурации обычно находится в:
- /etc/nginx/sites-available/default
- /etc/nginx/sites-available/api.rytmox.ai
- /etc/nginx/nginx.conf

После изменений выполнить:
- sudo nginx -t (проверка конфигурации)
- sudo systemctl reload nginx (перезагрузка)

Покажи текущую конфигурацию nginx для этого домена и внеси необходимые изменения.
```

## Альтернативный краткий промпт:

```
Исправить ошибку 413 в nginx для api.rytmox.ai: увеличить client_max_body_size до 50M для поддержки транскрибации аудио. Роут /chat/transcribe должен принимать запросы до 50MB с таймаутом 300s.
```

## Что нужно сделать вручную (если нет доступа через Cursor):

1. Подключиться к серверу:
   ```bash
   ssh user@api.rytmox.ai
   ```

2. Найти конфигурацию nginx:
   ```bash
   sudo find /etc/nginx -name "*.conf" | xargs grep -l "api.rytmox.ai"
   ```

3. Отредактировать конфигурацию:
   ```bash
   sudo nano /etc/nginx/sites-available/default
   # или
   sudo nano /etc/nginx/sites-available/api.rytmox.ai
   ```

4. Добавить/обновить настройки:
   ```nginx
   server {
       listen 80;
       server_name api.rytmox.ai;
       
       # Глобальный лимит для всего сервера
       client_max_body_size 50M;
       client_body_timeout 300s;
       proxy_read_timeout 300s;
       
       # Специфичные настройки для транскрибации
       location /chat/transcribe {
           client_max_body_size 50M;
           client_body_timeout 300s;
           proxy_read_timeout 300s;
           
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

5. Проверить и перезагрузить:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

6. Проверить логи:
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

