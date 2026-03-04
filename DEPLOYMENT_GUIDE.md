# 🚀 Deployment en Coolify - Guía Completa

## Opción Recomendada: Docker Compose ✅

### Por qué Docker Compose:
- ✅ MongoDB incluido automáticamente
- ✅ Network configurada automáticamente
- ✅ Volúmenes para persistencia de datos
- ✅ Health checks automáticos
- ✅ Más fácil de mantener

---

## 📋 Pre-requisitos

1. ✅ Código en GitHub: `https://github.com/tu-usuario/qre`
2. ✅ Coolify instalado en VPS
3. ✅ DNS configurado: `qre.facore.cloud` → IP del VPS

---

## 🐳 Opción 1: Docker Compose (RECOMENDADO)

### Paso 1: Verificar Archivos

Asegúrate que tu repositorio tenga:
- ✅ `docker-compose.yml` (en la raíz)
- ✅ `Dockerfile` (en la raíz)
- ✅ Código frontend y backend

### Paso 2: En Coolify

1. **Crear Nuevo Resource:**
   - Click **"+ New"** → **"Resource"**
   - Tipo: **"Git Repository"**

2. **Conectar Repositorio:**
   - Source: **GitHub**
   - Repository: **`tu-usuario/qre`**
   - Branch: **`main`**

3. **Build Configuration:**
   - Build Type: **"Docker Compose"** ← IMPORTANTE
   - Docker Compose File: **`docker-compose.yml`**
   - Port: **8001**

4. **Variables de Entorno:**
   
   Solo necesitas estas 2 (las demás están en docker-compose.yml):
   
   ```bash
   CORS_ORIGINS=https://qre.facore.cloud
   REACT_APP_BACKEND_URL=https://qre.facore.cloud
   ```

5. **Dominio:**
   - Domain: **`qre.facore.cloud`**
   - ✅ Enable SSL (Let's Encrypt)

6. **Deploy:**
   - Click **"Deploy"**
   - Espera 5-10 minutos
   - ¡Listo! ✅

### Paso 3: Verificar

```bash
# En tu VPS, verifica los contenedores
docker ps

# Deberías ver:
qre-app       -> Tu aplicación
qre-mongodb   -> Base de datos
```

**URL:** https://qre.facore.cloud

---

## 🔧 Opción 2: Dockerfile Solo (Alternativa)

Si prefieres usar solo Dockerfile:

### Paso 1: Instalar MongoDB Manualmente

```bash
docker network create coolify

docker run -d \
  --name mongodb \
  --network coolify \
  --restart unless-stopped \
  -p 127.0.0.1:27017:27017 \
  -v qre-mongodb-data:/data/db \
  mongo:7.0
```

### Paso 2: En Coolify

1. **Build Configuration:**
   - Build Type: **"Dockerfile"** ← IMPORTANTE
   - Dockerfile: **`./Dockerfile`**

2. **Network:**
   - Selecciona: **`coolify`**

3. **Variables de Entorno:**
   ```bash
   MONGO_URL=mongodb://mongodb:27017
   DB_NAME=qre_production
   CORS_ORIGINS=https://qre.facore.cloud
   REACT_APP_BACKEND_URL=https://qre.facore.cloud
   WDS_SOCKET_PORT=443
   ENABLE_HEALTH_CHECK=false
   ```

4. **Volumen para CSV:**
   - Host: `/var/lib/coolify/qre/data`
   - Container: `/app/data`

---

## 📊 Comparación

| Característica | Docker Compose | Dockerfile Solo |
|----------------|----------------|-----------------|
| MongoDB incluido | ✅ Automático | ⚠️ Manual |
| Network | ✅ Automática | ⚠️ Manual |
| Volúmenes | ✅ Definidos | ⚠️ Manual |
| Mantenimiento | ✅ Fácil | ⚠️ Más complejo |
| Health checks | ✅ Incluidos | ❌ No |
| **Recomendación** | ✅ **USAR ESTO** | Solo si necesario |

---

## 🔍 Troubleshooting

### Ver Logs (Docker Compose):
```bash
# Logs de la app
docker logs qre-app -f

# Logs de MongoDB
docker logs qre-mongodb -f

# O desde Coolify: Tab "Logs"
```

### Verificar MongoDB:
```bash
docker exec -it qre-mongodb mongosh --eval "db.adminCommand('ping')"
```

### Reiniciar Servicios:
```bash
# Desde el directorio del proyecto
docker-compose restart

# O en Coolify: Click "Restart"
```

### Verificar Volúmenes:
```bash
docker volume ls | grep qre

# Deberías ver:
qre_mongodb-data
qre_csv-data
```

### Verificar CSV Generados:
```bash
# Listar archivos CSV
docker exec qre-app ls -lh /app/data/

# Ver contenido de un CSV
docker exec qre-app cat /app/data/barras_20250130_v1.csv
```

---

## ✅ Checklist de Deployment

### Pre-deployment:
- [ ] Código subido a GitHub
- [ ] `docker-compose.yml` en el repo
- [ ] `Dockerfile` en el repo
- [ ] DNS configurado (qre.facore.cloud)

### En Coolify:
- [ ] Repositorio conectado
- [ ] Build type: "Docker Compose"
- [ ] Variables de entorno configuradas
- [ ] Dominio configurado
- [ ] SSL habilitado
- [ ] Deploy iniciado

### Post-deployment:
- [ ] Contenedores corriendo (docker ps)
- [ ] App responde en https://qre.facore.cloud
- [ ] API responde en https://qre.facore.cloud/api/
- [ ] Login con Google funciona
- [ ] Scanner de QR funciona
- [ ] CSV se genera en /app/data

---

## 🎯 Comandos Útiles

```bash
# Estado de servicios
docker-compose ps

# Logs en tiempo real
docker-compose logs -f

# Reiniciar todo
docker-compose restart

# Detener todo
docker-compose down

# Iniciar todo
docker-compose up -d

# Ver volúmenes
docker volume inspect qre_csv-data

# Backup de CSV
docker cp qre-app:/app/data ./backup-csv-$(date +%Y%m%d)

# Backup de MongoDB
docker exec qre-mongodb mongodump --out=/backup
docker cp qre-mongodb:/backup ./backup-db-$(date +%Y%m%d)
```

---

## 📞 Soporte

Si encuentras problemas:
1. Revisa logs en Coolify
2. Verifica que los contenedores estén corriendo: `docker ps`
3. Verifica variables de entorno
4. Verifica que el DNS esté propagado: `nslookup qre.facore.cloud`

---

**¡Listo para deployment! 🚀**
