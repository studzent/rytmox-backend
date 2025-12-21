# Быстрое обновление транскрибации на сервере

## Команды для выполнения на сервере api.rytmox.ai:

```bash
# 1. Обновить код
cd /path/to/rytmox-backend
git fetch origin
git reset --hard origin/main
npm install

# 2. Перезапустить сервер
pm2 restart rytmox-backend

# 3. Проверить конфигурацию nginx (должен быть client_max_body_size 50M)
sudo nginx -t
sudo systemctl reload nginx

# 4. Проверить логи
pm2 logs rytmox-backend --lines 50
```

## Если транскрибация все еще не работает:

1. **Проверить nginx конфигурацию:**
   ```bash
   sudo grep -r "client_max_body_size" /etc/nginx/
   ```
   Должно быть `client_max_body_size 50M;`

2. **Проверить переменные окружения:**
   ```bash
   pm2 env rytmox-backend | grep OPENAI
   ```
   Должен быть `OPENAI_API_KEY`

3. **Проверить, что файл transcriptionService.js существует:**
   ```bash
   ls -la services/transcriptionService.js
   ```

4. **Проверить последний коммит:**
   ```bash
   git log -1 --oneline
   ```
   Должен быть коммит с транскрибацией

