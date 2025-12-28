# Инструкции для деплоя на DigitalOcean

## Шаги для обновления backend на сервере:

### 1. Подключитесь к серверу
```bash
ssh your-user@your-server-ip
```

### 2. Перейдите в директорию проекта
```bash
cd /path/to/rytmox-backend
```

### 3. Обновите код из git
```bash
git pull origin main
```

### 4. Перезапустите backend

**Если используете PM2:**
```bash
pm2 restart all
# или
pm2 restart rytmox-backend
```

**Если используете systemd:**
```bash
sudo systemctl restart rytmox-backend
```

**Если используете Docker:**
```bash
docker-compose restart backend
# или
docker-compose up -d --build
```

**Если используете npm/node напрямую:**
```bash
# Остановите текущий процесс (Ctrl+C или kill)
# Затем запустите снова:
npm start
# или
node server.js
```

### 5. Проверьте логи
```bash
# PM2:
pm2 logs

# systemd:
sudo journalctl -u rytmox-backend -f

# Docker:
docker-compose logs -f backend
```

### 6. Проверка работы
После перезапуска в логах приложения должно появиться:
```
[AppNavigator] Profile loaded: {"main_tab_module": "nutrition", ...}
```

Вместо:
```
[AppNavigator] Profile loaded: {"main_tab_module": undefined, ...}
```

