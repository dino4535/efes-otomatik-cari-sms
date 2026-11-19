#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename -- "${BASH_SOURCE[0]}")"
cd "$SCRIPT_DIR"

log() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mUYARI:\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mHATA:\033[0m %s\n' "$*" >&2; exit 1; }

if [[ ! -f docker-compose.yml || ! -f Dockerfile ]]; then
  die "Bu betik proje kök dizininde çalıştırılmalıdır (docker-compose.yml ve Dockerfile bulunamadı)."
fi

OS_RELEASE_FILE="${INSTALL_OS_RELEASE:-/etc/os-release}"
if [[ ! -r "$OS_RELEASE_FILE" ]]; then
  die "Linux dağıtımı algılanamadı."
fi
# shellcheck disable=SC1090
. "$OS_RELEASE_FILE"
if [[ "${ID:-}" != "ubuntu" ]]; then
  warn "Bu betik Ubuntu için hazırlandı; mevcut sistem: ${PRETTY_NAME:-bilinmiyor}."
fi

if [[ $EUID -eq 0 ]]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  die "Root değilsiniz ve sudo bulunamadı."
fi

apt_install() {
  $SUDO apt-get update
  $SUDO apt-get install -y "$@"
}

if ! command -v curl >/dev/null 2>&1; then
  log "curl kuruluyor..."
  apt_install curl ca-certificates
fi

install_docker() {
  log "Docker Engine ve Compose kuruluyor..."
  apt_install ca-certificates curl gnupg
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  local arch codename
  arch="$(dpkg --print-architecture)"
  codename="${VERSION_CODENAME:-}"
  [[ -n "$codename" ]] || die "Ubuntu sürüm kod adı bulunamadı."

  echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $codename stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker

  if [[ $EUID -ne 0 ]]; then
    local target_user="${SUDO_USER:-$USER}"
    $SUDO usermod -aG docker "$target_user" || true
    warn "Docker grubu için oturumu kapatıp açmanız gerekebilir. Bu kurulum sudo docker ile devam edecek."
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  log "Docker kurulu değil."
  IFS= read -r -p "Docker Engine + Compose otomatik kurulsun mu? [E/h]: " answer
  case "${answer:-E}" in
    h|H|n|N|hayir|hayır) die "Docker kurulmadan devam edilemez." ;;
  esac
  install_docker
fi

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if [[ -n "$SUDO" ]]; then
    $SUDO systemctl start docker >/dev/null 2>&1 || true
  else
    systemctl start docker >/dev/null 2>&1 || true
  fi
  if [[ -n "$SUDO" ]] && $SUDO docker info >/dev/null 2>&1; then
    DOCKER=("$SUDO" docker)
  elif docker info >/dev/null 2>&1; then
    DOCKER=(docker)
  else
    die "Docker servisine erişilemiyor. 'sudo systemctl start docker' ve kullanıcı grubu ayarlarını kontrol edin."
  fi
fi

if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
  COMPOSE=("${DOCKER[@]}" compose)
elif command -v docker-compose >/dev/null 2>&1; then
  if [[ -n "$SUDO" && "${DOCKER[0]}" == "sudo" ]]; then
    COMPOSE=("$SUDO" docker-compose)
  else
    COMPOSE=(docker-compose)
  fi
else
  warn "Docker Compose bulunamadı, docker-compose-plugin kuruluyor..."
  $SUDO apt-get install -y docker-compose-plugin
  "${DOCKER[@]}" compose version >/dev/null 2>&1 \
    || die "Docker Compose kurulamadı."
  COMPOSE=("${DOCKER[@]}" compose)
fi

ask() {
  local prompt="$1" default="$2" value
  IFS= read -r -p "$prompt [$default]: " value
  printf '%s' "${value:-$default}"
}

ask_required() {
  local prompt="$1" value
  while :; do
    IFS= read -r -p "$prompt: " value
    [[ -n "$value" ]] && { printf '%s' "$value"; return; }
    echo "Bu alan boş bırakılamaz." >&2
  done
}

ask_secret() {
  local prompt="$1" value confirm min_length="${2:-1}"
  while :; do
    IFS= read -r -s -p "$prompt: " value
    echo >&2
    if (( ${#value} < min_length )); then
      echo "En az $min_length karakter girin." >&2
      continue
    fi
    IFS= read -r -s -p "$prompt (tekrar): " confirm
    echo >&2
    if [[ "$value" != "$confirm" ]]; then
      echo "Değerler eşleşmedi, tekrar deneyin." >&2
      continue
    fi
    printf '%s' "$value"
    return
  done
}

ask_bool() {
  local prompt="$1" default="$2" value
  while :; do
    IFS= read -r -p "$prompt [$default]: " value
    value="${value:-$default}"
    case "${value,,}" in
      e|y|yes|evet|1) printf 'true'; return ;;
      h|n|no|hayir|hayır|0) printf 'false'; return ;;
      *) echo "Lütfen e/h girin." >&2 ;;
    esac
  done
}

ask_port() {
  local prompt="$1" default="$2" value
  while :; do
    value="$(ask "$prompt" "$default")"
    if [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 )); then
      printf '%s' "$value"
      return
    fi
    echo "Geçerli bir port girin (1-65535)." >&2
  done
}

ask_int() {
  local prompt="$1" default="$2" value
  while :; do
    value="$(ask "$prompt" "$default")"
    if [[ "$value" =~ ^-?[0-9]+$ ]]; then
      printf '%s' "$value"
      return
    fi
    echo "Geçerli bir sayı girin." >&2
  done
}

env_quote() {
  local value="$1"
  if [[ "$value" =~ ^[A-Za-z0-9_./:@+-]*$ ]]; then
    printf '%s' "$value"
  elif [[ "$value" != *"'"* ]]; then
    printf "'%s'" "$value"
  else
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//\$/\\\$}"
    printf '"%s"' "$value"
  fi
}

if [[ -f .env ]]; then
  warn ".env dosyası zaten var."
  IFS= read -r -p "Yedeklenip yeniden oluşturulsun mu? [e/H]: " overwrite
  case "${overwrite:-H}" in
    e|E|y|Y|evet|Evet) cp -a .env ".env.bak.$(date +%Y%m%d-%H%M%S)" ;;
    *) die "Kurulum iptal edildi; mevcut .env korundu." ;;
  esac
fi

log "Kurulum bilgileri"
echo "Bu bilgiler .env dosyasına yazılacak ve repoya eklenmeyecek."
echo

HOST_PORT="$(ask_port 'Dış (host) port' '5555')"
APP_COMPANY_NAME="$(ask 'Firma adı' 'Efes')"
APP_BRANCH="$(ask_int 'Varsayılan şube kodu' '3')"
APP_TIMEZONE="$(ask 'Saat dilimi' 'Europe/Istanbul')"
ADMIN_USERNAME="$(ask 'İlk admin kullanıcı adı' 'admin')"
ADMIN_FULL_NAME="$(ask 'Admin adı soyadı' 'Sistem Yöneticisi')"
ADMIN_PASSWORD="$(ask_secret 'Admin şifresi (en az 8 karakter)' 8)"

echo
log "ERP bağlantısı"
ERP_SERVER="$(ask_required 'ERP SQL Server adresi/IP')"
ERP_PORT="$(ask_port 'ERP portu' '1433')"
ERP_DATABASE="$(ask 'ERP veritabanı' 'DINO2026')"
ERP_USER="$(ask_required 'ERP kullanıcısı')"
ERP_PASSWORD="$(ask_secret 'ERP şifresi' 1)"
ERP_ENCRYPT="$(ask_bool 'ERP bağlantısında TLS kullanılsın mı?' 'h')"
ERP_TRUST_CERT="$(ask_bool 'ERP sunucu sertifikasına güvenilsin mi?' 'e')"

SESSION_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
[[ -n "$SESSION_SECRET" ]] || die "Oturum anahtarı üretilemedi."

if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | awk 'NR > 1 {print $4}' | grep -qE "[:.]${HOST_PORT}$"; then
    die "Seçilen port kullanımda görünüyor. Önce mevcut servisi durdurun veya farklı port seçin."
  fi
fi

log ".env oluşturuluyor..."
umask 077
ENV_TMP="$(mktemp "$SCRIPT_DIR/.env.tmp.XXXXXX")"
{
  printf 'PORT=%s\n' "$HOST_PORT"
  printf 'HOST=0.0.0.0\n'
  printf 'NODE_ENV=production\n'
  printf 'APP_COMPANY_NAME=%s\n' "$(env_quote "$APP_COMPANY_NAME")"
  printf 'APP_BRANCH=%s\n' "$APP_BRANCH"
  printf 'APP_TIMEZONE=%s\n' "$(env_quote "$APP_TIMEZONE")"
  printf 'ERP_SERVER=%s\n' "$(env_quote "$ERP_SERVER")"
  printf 'ERP_PORT=%s\n' "$ERP_PORT"
  printf 'ERP_DATABASE=%s\n' "$(env_quote "$ERP_DATABASE")"
  printf 'ERP_USER=%s\n' "$(env_quote "$ERP_USER")"
  printf 'ERP_PASSWORD=%s\n' "$(env_quote "$ERP_PASSWORD")"
  printf 'ERP_ENCRYPT=%s\n' "$ERP_ENCRYPT"
  printf 'ERP_TRUST_CERT=%s\n' "$ERP_TRUST_CERT"
  printf 'APP_DB_PATH=/app/data/app.db\n'
  printf 'SESSION_SECRET=%s\n' "$SESSION_SECRET"
  printf 'SESSION_HOURS=8\n'
  printf 'ADMIN_USERNAME=%s\n' "$(env_quote "$ADMIN_USERNAME")"
  printf 'ADMIN_INITIAL_PASSWORD=%s\n' "$(env_quote "$ADMIN_PASSWORD")"
  printf 'ADMIN_FULL_NAME=%s\n' "$(env_quote "$ADMIN_FULL_NAME")"
  printf 'TZ=%s\n' "$(env_quote "$APP_TIMEZONE")"
} > "$ENV_TMP"
chmod 600 "$ENV_TMP"
if ! mv -f "$ENV_TMP" .env; then
  rm -f -- "$ENV_TMP"
  die ".env dosyası yazılamadı."
fi
chmod 600 .env
if [[ -n "$SUDO" && -n "${SUDO_USER:-}" ]]; then
  $SUDO chown "$SUDO_USER:" .env 2>/dev/null || true
fi

log "Docker Compose yapılandırması kontrol ediliyor..."
export PORT="$HOST_PORT"
export APP_TIMEZONE
"${COMPOSE[@]}" config -q

log "İmaj oluşturuluyor ve sistem başlatılıyor..."
"${COMPOSE[@]}" up -d --build

log "Sağlık kontrolü bekleniyor..."
healthy=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/healthz" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" != "1" ]]; then
  "${COMPOSE[@]}" ps || true
  "${COMPOSE[@]}" logs --tail=120 || true
  die "Uygulama sağlık kontrolünden geçemedi. Kurulum betiği silinmedi; logları kontrol edip tekrar deneyin."
fi

SERVER_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i=="src") {print $(i+1); exit}}' || true)"
if [[ -z "$SERVER_IP" ]]; then
  SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi
[[ -n "$SERVER_IP" ]] || SERVER_IP="<sunucu-ip>"

"${COMPOSE[@]}" ps
printf '\n============================================================\n'
printf 'Kurulum tamamlandı.\n'
printf '============================================================\n'
printf 'Adres:       http://%s:%s\n' "$SERVER_IP" "$HOST_PORT"
printf 'Yerel:       http://127.0.0.1:%s\n' "$HOST_PORT"
printf 'Admin:       %s\n' "$ADMIN_USERNAME"
printf '.env:        %s/.env\n' "$SCRIPT_DIR"
printf '\nİlk girişte admin şifresini değiştirmeniz istenir.\n'
printf 'Docker volume: efes-data (uygulama verisi), efes-logs (loglar)\n'
printf 'Güvenlik duvarı: gerekirse sudo ufw allow %s/tcp\n' "$HOST_PORT"
printf '============================================================\n'

if rm -f -- "$SCRIPT_PATH"; then
  echo "Kurulum betiği silindi: $SCRIPT_PATH"
else
  warn "Kurulum betiği silinemedi: $SCRIPT_PATH"
fi
