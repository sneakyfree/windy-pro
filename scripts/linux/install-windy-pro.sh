#!/bin/sh
# ═══════════════════════════════════════════════════════════════════
# 🌪️  Windy Pro v0.6.0 — Universal Linux Installer
# ═══════════════════════════════════════════════════════════════════
# Works on: Ubuntu, Debian, Mint, Pop!_OS, elementary, Fedora, RHEL,
#           CentOS, Arch, Manjaro, EndeavourOS, openSUSE, Alpine,
#           Void, Gentoo, NixOS, and ANY other x86_64 Linux.
#
# Usage:
#   bash install-windy-pro.sh                     # Auto-detect everything
#   bash install-windy-pro.sh windy-pro.deb       # Use local .deb
#   curl -fsSL .../install-windy-pro.sh | bash    # One-liner
# ═══════════════════════════════════════════════════════════════════
set -e

WP_VERSION="0.6.0"
REPO="sneakyfree/windy-pro"
DEB_URL="https://github.com/${REPO}/releases/download/v${WP_VERSION}/windy-pro_${WP_VERSION}_amd64.deb"
APPIMAGE_URL="https://github.com/${REPO}/releases/download/v${WP_VERSION}/Windy-Pro-${WP_VERSION}.AppImage"
MINIFORGE_URL="https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh"
APP_DIR="$HOME/.windy-pro"
HAS_ZENITY=0
PKG_MGR=""
DISTRO_NAME=""
DISTRO_FAMILY=""
INSTALL_METHOD="" # deb, appimage

# ─── Logging ────────────────────────────────────────────────────

LOG="/tmp/windy-pro-install.log"
# Ensure we can write to log (may be owned by root from previous sudo run)
if ! touch "$LOG" 2>/dev/null; then
  LOG="$HOME/.windy-pro-install.log"
fi
log()  { echo "[Windy Pro] $*" | tee -a "$LOG"; }
warn() { echo "[Windy Pro] ⚠️  $*" | tee -a "$LOG"; }
die()  {
  echo "[Windy Pro] ❌ $*" | tee -a "$LOG"
  if [ "$HAS_ZENITY" = "1" ]; then
    zenity --error --title="Windy Pro Installer" \
      --text="$*\n\nFull log: $LOG\nSupport: dev@thewindstorm.uk" --width=450 2>/dev/null || true
  fi
  exit 1
}

# ─── Step 0: Detect Display + Zenity ───────────────────────────

setup_gui() {
  if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
    log "No display detected. Running in terminal mode."
    return
  fi
  if command -v zenity >/dev/null 2>&1; then
    HAS_ZENITY=1
    return
  fi
  # Try kdialog as alternative
  if command -v kdialog >/dev/null 2>&1; then
    log "Zenity not found, kdialog available (KDE). Using terminal mode for consistency."
    return
  fi
  log "Zenity not found. Running in terminal mode."
}

# ─── Step 1: Detect Distro + Package Manager ──────────────────

detect_distro() {
  # Read /etc/os-release (works on 99% of modern Linux)
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_NAME="${PRETTY_NAME:-$NAME}"
  elif [ -f /etc/lsb-release ]; then
    . /etc/lsb-release
    DISTRO_NAME="${DISTRIB_DESCRIPTION:-$DISTRIB_ID}"
  else
    DISTRO_NAME="Unknown Linux"
  fi

  # Detect package manager
  if command -v apt-get >/dev/null 2>&1; then
    PKG_MGR="apt"
    DISTRO_FAMILY="debian"
    INSTALL_METHOD="deb"
  elif command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
    DISTRO_FAMILY="fedora"
    INSTALL_METHOD="appimage"
  elif command -v yum >/dev/null 2>&1; then
    PKG_MGR="yum"
    DISTRO_FAMILY="fedora"
    INSTALL_METHOD="appimage"
  elif command -v pacman >/dev/null 2>&1; then
    PKG_MGR="pacman"
    DISTRO_FAMILY="arch"
    INSTALL_METHOD="appimage"
  elif command -v zypper >/dev/null 2>&1; then
    PKG_MGR="zypper"
    DISTRO_FAMILY="suse"
    INSTALL_METHOD="appimage"
  elif command -v apk >/dev/null 2>&1; then
    PKG_MGR="apk"
    DISTRO_FAMILY="alpine"
    INSTALL_METHOD="appimage"
  elif command -v emerge >/dev/null 2>&1; then
    PKG_MGR="emerge"
    DISTRO_FAMILY="gentoo"
    INSTALL_METHOD="appimage"
  elif command -v xbps-install >/dev/null 2>&1; then
    PKG_MGR="xbps"
    DISTRO_FAMILY="void"
    INSTALL_METHOD="appimage"
  elif command -v nix-env >/dev/null 2>&1; then
    PKG_MGR="nix"
    DISTRO_FAMILY="nix"
    INSTALL_METHOD="appimage"
  else
    PKG_MGR="unknown"
    DISTRO_FAMILY="unknown"
    INSTALL_METHOD="appimage"
  fi

  log "Detected: $DISTRO_NAME ($PKG_MGR)"
}

# ─── Step 2: Welcome ──────────────────────────────────────────

show_welcome() {
  if [ "$HAS_ZENITY" = "1" ]; then
    zenity --question \
      --title="🌪️ Windy Pro v${WP_VERSION}" \
      --text="<b>Windy Pro v${WP_VERSION}</b>\n\nVoice-to-text, powered by AI.\n100% local. 100% private.\n\nDetected: <b>$DISTRO_NAME</b>\nInstall method: <b>$INSTALL_METHOD</b>" \
      --ok-label="Install" --cancel-label="Cancel" \
      --width=450 --height=220 2>/dev/null || exit 0
  else
    echo ""
    echo "  🌪️  Windy Pro v${WP_VERSION} — Universal Installer"
    echo "  ────────────────────────────────────────────"
    echo "  Voice-to-text, powered by AI. 100% local, 100% private."
    echo ""
    echo "  Detected: $DISTRO_NAME ($PKG_MGR)"
    echo "  Install method: $INSTALL_METHOD"
    echo ""
    printf "  Continue? [Y/n] "
    read -r ans
    case "$ans" in n*|N*) exit 0 ;; esac
  fi
}

# ─── Step 3: Check Old Installations ──────────────────────────

cleanup_old_versions() {
  OLD=""

  # Check dpkg (Debian-based)
  if command -v dpkg >/dev/null 2>&1 && dpkg -l windy-pro 2>/dev/null | grep -q '^ii'; then
    OLD=$(dpkg-query -W -f='${Version}' windy-pro 2>/dev/null || echo "unknown")
    log "Found existing .deb installation: v$OLD"
  fi

  # Check for old AppImages
  OLD_APPIMAGE=""
  for search_dir in "$HOME" "$HOME/Downloads" "$HOME/.local/bin" "$HOME/Applications"; do
    found=$(find "$search_dir" -maxdepth 2 -name "*.AppImage" -iname "*windy*" -type f 2>/dev/null | head -1)
    if [ -n "$found" ]; then
      OLD_APPIMAGE="$found"
      log "Found old AppImage: $OLD_APPIMAGE"
    fi
  done

  # Check /opt installs
  for d in /opt/Windy* /opt/windy* "$HOME/.local/share/windy-pro"; do
    [ -d "$d" ] && log "Found old installation directory: $d"
  done

  # Show upgrade dialog
  if [ -n "$OLD" ]; then
    if [ "$HAS_ZENITY" = "1" ]; then
      zenity --question \
        --title="⬆️ Upgrade Detected" \
        --text="<b>Windy Pro v$OLD</b> is currently installed.\nUpgrading to <b>v${WP_VERSION}</b>.\n\n✅ Your recordings will NOT be deleted\n✅ Settings are preserved\n\nYour data: <tt>~/Documents/WindyProArchive/</tt>" \
        --ok-label="Upgrade Now" --cancel-label="Cancel" \
        --width=480 --height=260 2>/dev/null || exit 0
    else
      log "Upgrading from v$OLD to v$WP_VERSION"
      log "✅ Your recordings in ~/Documents/WindyProArchive/ are safe."
    fi
  fi

  # Kill running instances
  if pgrep -f "windy-pro\|Windy Pro\|WindyPro" >/dev/null 2>&1; then
    log "Stopping running Windy Pro instances..."
    if [ "$HAS_ZENITY" = "1" ]; then
      zenity --question \
        --title="⚠️ Windy Pro is Running" \
        --text="We need to close the running instance.\nUnsaved work will be saved automatically." \
        --ok-label="Close & Continue" --cancel-label="Cancel" \
        --width=400 --height=160 2>/dev/null || exit 0
    fi
    pkill -f "windy-pro" 2>/dev/null || true
    pkill -f "Windy Pro" 2>/dev/null || true
    pkill -f "WindyPro" 2>/dev/null || true
    sleep 2
    pkill -9 -f "windy-pro" 2>/dev/null || true
    pkill -9 -f "Windy Pro" 2>/dev/null || true
  fi
}

# ─── Step 4: Install System Dependencies ──────────────────────

install_system_deps() {
  log "Installing system dependencies ($PKG_MGR)..."

  case "$DISTRO_FAMILY" in
    debian)
      run_sudo "apt-get update -y" || true
      run_sudo "apt-get install -y \
        python3 python3-venv python3-pip python3-dev python3-full \
        ffmpeg portaudio19-dev libportaudio2 libasound2-dev pulseaudio libpulse-dev \
        alsa-utils libsndfile1-dev sox \
        gstreamer1.0-tools gstreamer1.0-plugins-good \
        build-essential libffi-dev libssl-dev \
        zenity xdotool xclip xsel wl-clipboard curl wget \
        2>/dev/null || true"
      ;;
    fedora)
      run_sudo "$PKG_MGR install -y \
        python3 python3-devel python3-pip python3-virtualenv \
        ffmpeg-free portaudio-devel alsa-lib-devel pulseaudio-libs-devel \
        sox gstreamer1-plugins-good \
        gcc libffi-devel openssl-devel \
        zenity xdotool xclip xsel wl-clipboard curl wget \
        2>/dev/null || true"
      ;;
    arch)
      run_sudo "pacman -Sy --noconfirm \
        python python-pip python-virtualenv \
        ffmpeg portaudio alsa-utils pulseaudio libpulse \
        sox gstreamer gst-plugins-good \
        base-devel libffi openssl \
        zenity xdotool xclip xsel wl-clipboard curl wget \
        2>/dev/null || true"
      ;;
    suse)
      run_sudo "zypper --non-interactive install \
        python3 python3-devel python3-pip python3-virtualenv \
        ffmpeg-4 portaudio-devel alsa-devel pulseaudio-devel \
        sox gstreamer-plugins-good \
        gcc libffi-devel libopenssl-devel \
        zenity xdotool xclip xsel wl-clipboard curl wget \
        2>/dev/null || true"
      ;;
    alpine)
      run_sudo "apk add \
        python3 python3-dev py3-pip py3-virtualenv \
        ffmpeg portaudio-dev alsa-lib-dev pulseaudio-dev \
        sox build-base libffi-dev openssl-dev \
        zenity xdotool xclip curl wget \
        2>/dev/null || true"
      ;;
    void)
      run_sudo "xbps-install -Sy \
        python3 python3-devel python3-pip \
        ffmpeg portaudio-devel alsa-lib-devel pulseaudio-devel \
        sox gcc libffi-devel openssl-devel \
        zenity xdotool xclip xsel curl wget \
        2>/dev/null || true"
      ;;
    *)
      warn "Unknown package manager ($PKG_MGR). Skipping system deps."
      warn "You may need to manually install: python3 python3-pip ffmpeg"
      ;;
  esac

  log "System dependencies installed."
}

# ─── Step 5: Ensure Python 3.9+ ──────────────────────────────

ensure_python() {
  PYTHON_BIN=""
  for cmd in python3.12 python3.11 python3.10 python3.9 python3 python; do
    if command -v "$cmd" >/dev/null 2>&1; then
      ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
      major=$(echo "$ver" | cut -d. -f1)
      minor=$(echo "$ver" | cut -d. -f2)
      if [ "$major" -ge 3 ] 2>/dev/null && [ "$minor" -ge 9 ] 2>/dev/null; then
        PYTHON_BIN="$cmd"
        log "Found Python $ver ($cmd)"
        return
      fi
    fi
  done

  # No Python 3.9+ — install Miniforge as nuclear fallback
  warn "No Python 3.9+ found. Installing portable Python (Miniforge)..."
  install_miniforge
}

install_miniforge() {
  MINIFORGE_DIR="$APP_DIR/python"

  if [ -x "$MINIFORGE_DIR/bin/python3" ]; then
    PYTHON_BIN="$MINIFORGE_DIR/bin/python3"
    log "Miniforge already installed."
    return
  fi

  mkdir -p "$APP_DIR"
  MINIFORGE_SH="/tmp/miniforge-installer.sh"

  log "Downloading Miniforge (~80 MB)..."
  download_file "$MINIFORGE_URL" "$MINIFORGE_SH"

  log "Installing portable Python..."
  bash "$MINIFORGE_SH" -b -p "$MINIFORGE_DIR" >/dev/null 2>&1
  rm -f "$MINIFORGE_SH"

  PYTHON_BIN="$MINIFORGE_DIR/bin/python3"
  if [ -x "$PYTHON_BIN" ]; then
    log "Portable Python installed: $($PYTHON_BIN --version)"
  else
    die "Failed to install portable Python.\n\nTry manually: https://github.com/conda-forge/miniforge"
  fi
}

# ─── Step 6: Setup Python Venv + Packages ─────────────────────

setup_python_env() {
  VENV_DIR="$APP_DIR/venv"
  VENV_PYTHON="$VENV_DIR/bin/python3"

  # Fast path: already set up
  if [ -x "$VENV_PYTHON" ]; then
    if "$VENV_PYTHON" -c "import faster_whisper, sounddevice, websockets" 2>/dev/null; then
      log "Python environment already configured — skipping."
      return
    fi
  fi

  # Ensure python3-venv is available (bulk dep install may have silently failed)
  if [ "$DISTRO_FAMILY" = "debian" ]; then
    log "Ensuring python3-venv is installed..."
    run_sudo "apt-get install -y python3-venv" 2>/dev/null || true
  fi

  log "Creating Python environment..."
  "$PYTHON_BIN" -m venv "$VENV_DIR" 2>/dev/null || \
    "$PYTHON_BIN" -m virtualenv "$VENV_DIR" 2>/dev/null || \
    die "Cannot create Python virtual environment.\n\nTry: sudo apt-get install -y python3-venv"

  PIP="$VENV_DIR/bin/pip"
  "$PIP" install --upgrade pip setuptools wheel 2>&1 | tail -1 || true

  log "Installing AI engine packages (this may take several minutes)..."
  PACKAGES="faster-whisper torch torchaudio sounddevice numpy websockets scipy librosa pydub"
  for pkg in $PACKAGES; do
    log "  Installing $pkg..."
    "$PIP" install "$pkg" 2>&1 | tail -1 || warn "  $pkg failed — may still work"
  done

  log "Python AI engine ready."
}

# ─── Step 7: Install Windy Pro App ────────────────────────────

find_or_download_package() {
  DEB_PATH=""

  # Check if passed as argument
  if [ -n "$1" ] && [ -f "$1" ]; then
    if echo "$1" | grep -q "\.deb$"; then
      INSTALL_METHOD="deb"
    fi
    DEB_PATH="$1"
    log "Using provided file: $DEB_PATH"
    return
  fi

  # For .deb distros, search for existing .deb
  if [ "$INSTALL_METHOD" = "deb" ]; then
    for search_dir in "." "$HOME/Downloads" "/tmp"; do
      found=$(find "$search_dir" -maxdepth 1 -name "windy-pro_*.deb" -type f 2>/dev/null | sort -r | head -1)
      if [ -n "$found" ]; then
        DEB_PATH="$found"
        log "Found .deb: $DEB_PATH"
        return
      fi
    done
  fi

  # Ask to download
  if [ "$HAS_ZENITY" = "1" ]; then
    zenity --question \
      --title="📥 Download Windy Pro" \
      --text="Download Windy Pro v${WP_VERSION}?\n\nFormat: <b>$INSTALL_METHOD</b> (~235-289 MB)" \
      --ok-label="Download" --cancel-label="Cancel" \
      --width=400 --height=160 2>/dev/null || exit 0
  else
    log "Downloading Windy Pro v${WP_VERSION}..."
  fi

  if [ "$INSTALL_METHOD" = "deb" ]; then
    DEB_PATH="/tmp/windy-pro_${WP_VERSION}_amd64.deb"
    download_file "$DEB_URL" "$DEB_PATH"
  else
    DEB_PATH="/tmp/Windy-Pro-${WP_VERSION}.AppImage"
    download_file "$APPIMAGE_URL" "$DEB_PATH"
  fi
}

install_app() {
  if echo "$DEB_PATH" | grep -qi "\.deb$"; then
    install_deb
  else
    install_appimage
  fi
}

install_deb() {
  log "Installing .deb package..."

  if [ "$HAS_ZENITY" = "1" ]; then
    (
      echo "25"; echo "# Installing Windy Pro v${WP_VERSION}..."
      run_sudo "dpkg -i \"$DEB_PATH\"" 2>&1 || true
      echo "75"; echo "# Fixing dependencies..."
      run_sudo "apt-get --fix-broken install -y" 2>&1 || true
      echo "100"; echo "# Done!"
    ) | zenity --progress --title="Installing Windy Pro" \
        --text="Installing..." --percentage=0 --auto-close --no-cancel \
        --width=400 2>/dev/null || true
  else
    run_sudo "dpkg -i \"$DEB_PATH\"" || true
    run_sudo "apt-get --fix-broken install -y" 2>/dev/null || true
  fi

  # Verify
  if command -v windy-pro >/dev/null 2>&1 || [ -x "/opt/Windy Pro/windy-pro" ]; then
    log "✅ .deb installed successfully."
  else
    warn "Installation may have failed. Falling back to AppImage..."
    DEB_PATH="/tmp/Windy-Pro-${WP_VERSION}.AppImage"
    download_file "$APPIMAGE_URL" "$DEB_PATH"
    install_appimage
  fi
}

install_appimage() {
  log "Installing AppImage (works on all Linux distros)..."

  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"

  APPIMAGE_PATH="$INSTALL_DIR/windy-pro.AppImage"
  if [ "$DEB_PATH" != "$APPIMAGE_PATH" ]; then
    cp "$DEB_PATH" "$APPIMAGE_PATH"
  fi
  chmod +x "$APPIMAGE_PATH"

  # Create desktop shortcut
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cat > "$DESKTOP_DIR/windy-pro.desktop" << DESKTOP
[Desktop Entry]
Name=Windy Pro
Comment=Voice-to-text transcription — 100% local, 100% private
GenericName=Voice Transcription
Exec=$APPIMAGE_PATH --no-sandbox %U
Icon=windy-pro
Type=Application
StartupNotify=true
StartupWMClass=windy-pro
Categories=Utility;Audio;Accessibility;
Keywords=voice;transcription;speech;text;whisper;dictation;
DESKTOP

  # Create CLI symlink
  ln -sf "$APPIMAGE_PATH" "$INSTALL_DIR/windy-pro" 2>/dev/null || true

  # Update desktop database
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  fi

  # Ensure ~/.local/bin is in PATH
  case "$PATH" in
    *"$INSTALL_DIR"*) ;;
    *)
      for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
        if [ -f "$rc" ] && ! grep -q "\.local/bin" "$rc" 2>/dev/null; then
          echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
          break
        fi
      done
      export PATH="$INSTALL_DIR:$PATH"
      ;;
  esac

  log "✅ AppImage installed to $APPIMAGE_PATH"
}

# ─── Step 8: Verify ──────────────────────────────────────────

verify_install() {
  log "Verifying installation..."
  ERRORS=0

  # Check app binary
  if command -v windy-pro >/dev/null 2>&1 || \
     [ -x "/opt/Windy Pro/windy-pro" ] || \
     [ -x "$HOME/.local/bin/windy-pro.AppImage" ]; then
    log "  ✅ Windy Pro binary found"
  else
    warn "  ❌ Windy Pro binary not found in PATH"
    ERRORS=$((ERRORS + 1))
  fi

  # Check Python
  VENV_PYTHON="$APP_DIR/venv/bin/python3"
  if [ -x "$VENV_PYTHON" ]; then
    if "$VENV_PYTHON" -c "import faster_whisper; print('OK')" 2>/dev/null; then
      log "  ✅ AI engine (faster-whisper) ready"
    else
      warn "  ⚠️  AI engine partially installed (may download on first use)"
    fi
  else
    log "  ℹ️  AI engine will be set up on first launch"
  fi

  # Check ffmpeg
  if command -v ffmpeg >/dev/null 2>&1; then
    log "  ✅ ffmpeg available"
  else
    warn "  ⚠️  ffmpeg not found — install it for best results"
  fi

  # Check audio
  if command -v pulseaudio >/dev/null 2>&1 || command -v pipewire >/dev/null 2>&1; then
    log "  ✅ Audio system detected"
  else
    warn "  ⚠️  No audio system detected — microphone may not work"
  fi

  if [ "$ERRORS" -gt 0 ]; then
    warn "Installation completed with $ERRORS warning(s). Check $LOG for details."
  else
    log "All checks passed!"
  fi
}

# ─── Step 9: Success ──────────────────────────────────────────

show_success() {
  if [ "$HAS_ZENITY" = "1" ]; then
    zenity --question \
      --title="✅ Windy Pro v${WP_VERSION} Installed!" \
      --text="Installation successful!\n\nYour recordings are safe in:\n<tt>~/Documents/WindyProArchive/</tt>\n\nLaunch Windy Pro now?" \
      --ok-label="Launch Now" --cancel-label="Close" \
      --width=420 --height=200 2>/dev/null
    if [ $? -eq 0 ]; then launch_app; fi
  else
    echo ""
    echo "  ✅ Windy Pro v${WP_VERSION} installed successfully!"
    echo "  Your recordings: ~/Documents/WindyProArchive/"
    echo ""
    printf "  Launch now? [Y/n] "
    read -r ans
    case "$ans" in n*|N*) ;; *) launch_app ;; esac
  fi
}

launch_app() {
  log "Launching Windy Pro..."
  if command -v windy-pro >/dev/null 2>&1; then
    nohup windy-pro >/dev/null 2>&1 &
  elif [ -x "/opt/Windy Pro/windy-pro" ]; then
    nohup "/opt/Windy Pro/windy-pro" >/dev/null 2>&1 &
  elif [ -x "$HOME/.local/bin/windy-pro.AppImage" ]; then
    nohup "$HOME/.local/bin/windy-pro.AppImage" --no-sandbox >/dev/null 2>&1 &
  else
    warn "Could not find Windy Pro binary to launch."
  fi
}

# ─── Helpers ──────────────────────────────────────────────────

run_sudo() {
  if [ "$(id -u)" = "0" ]; then
    sh -c "$1"
  elif command -v pkexec >/dev/null 2>&1 && [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
    pkexec sh -c "$1"
  elif command -v sudo >/dev/null 2>&1; then
    sudo sh -c "$1"
  else
    warn "No sudo/pkexec available. Trying without elevated privileges..."
    sh -c "$1" || true
  fi
}

download_file() {
  url="$1"
  dest="$2"
  log "Downloading: $url"

  if [ "$HAS_ZENITY" = "1" ]; then
    wget --progress=dot:mega "$url" -O "$dest" 2>&1 | \
      sed -u 's/.*\([0-9]\+\)%.*/\1/' | \
      zenity --progress --title="Downloading Windy Pro" \
        --text="Downloading v${WP_VERSION}..." \
        --auto-close --auto-kill --width=400 2>/dev/null
    if [ $? -ne 0 ]; then rm -f "$dest" 2>/dev/null; die "Download cancelled."; fi
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress -q "$url" -O "$dest" || die "Download failed. Check internet."
  elif command -v curl >/dev/null 2>&1; then
    curl -fSL --progress-bar "$url" -o "$dest" || die "Download failed. Check internet."
  else
    die "No download tool (wget/curl) found.\n\nInstall wget or curl first."
  fi

  if [ ! -f "$dest" ] || [ "$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null || echo 0)" -lt 1000000 ]; then
    rm -f "$dest" 2>/dev/null
    die "Download failed or file is corrupted."
  fi

  log "Downloaded: $dest"
}

# ─── Main Flow ────────────────────────────────────────────────

main() {
  echo "" >> "$LOG"
  log "═══ Windy Pro v${WP_VERSION} Installer — $(date) ═══"

  setup_gui
  detect_distro
  show_welcome
  cleanup_old_versions

  # Progress: deps (Step 4-6)
  if [ "$HAS_ZENITY" = "1" ]; then
    (
      echo "5"; echo "# Detected: $DISTRO_NAME ($PKG_MGR)"
      # System deps
      echo "10"; echo "# Installing system dependencies..."
      install_system_deps 2>&1 | tee -a "$LOG" | tail -1
      echo "30"; echo "# Setting up Python AI engine..."
      ensure_python 2>&1 | tee -a "$LOG" | tail -1
      echo "50"; echo "# Installing AI packages..."
      setup_python_env 2>&1 | tee -a "$LOG" | tail -1
      echo "65"; echo "# Downloading Windy Pro..."
      find_or_download_package "$1" 2>&1 | tee -a "$LOG" | tail -1
      echo "80"; echo "# Installing Windy Pro..."
      install_app 2>&1 | tee -a "$LOG" | tail -1
      echo "95"; echo "# Verifying..."
      verify_install 2>&1 | tee -a "$LOG" | tail -1
      echo "100"; echo "# Done!"
    ) | zenity --progress --title="Installing Windy Pro v${WP_VERSION}" \
        --text="Starting..." --percentage=0 --auto-close --no-cancel \
        --width=500 2>/dev/null || true
  else
    install_system_deps
    ensure_python
    setup_python_env
    find_or_download_package "$1"
    install_app
    verify_install
  fi

  # Guard: if venv creation failed (e.g. in Zenity subshell where die/exit
  # only kills the subshell), stop here instead of launching a broken app
  VENV_PYTHON_CHECK="$APP_DIR/venv/bin/python3"
  if [ ! -x "$VENV_PYTHON_CHECK" ]; then
    die "Python AI backend failed to install.\n\nThe virtual environment at $APP_DIR/venv was not created.\nRe-run the installer or try: sudo apt-get install -y python3-venv\n\nFull log: $LOG"
  fi

  show_success
  log "═══ Installation complete ═══"
}

main "$@"
