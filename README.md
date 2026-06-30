# OmniPlayr 🎵

> A self-hosted, extensible media platform - unify audio streaming from multiple sources.

OmniPlayr is a **self-hosted, plugin-based audio platform** that lets you stream and manage audio from different sources through a single, consistent API. The backend, web UI, and plugin system are fully functional, and the project is designed for developers to add new plugins and extend the platform.

---

## ⚠️ Work in Progress

This project is under active development. The **streaming backend, web UI, and plugin system are working**. Contributions, ideas, and plugins are highly welcome.

---

## ✅ Features

- 🔌 **Plugin architecture** - easily add new audio sources
- 🎧 **Unified streaming API** - clients can access audio without knowing the source plugin
- 📦 **Self-hosted** - deploy with Docker or Python
- 🌐 **Web UI** - control your audio from any device

---

## 🛠 Plugin Support

Each audio source is implemented as a plugin. The **MP3 plugin is fully functional**, and more sources can be added easily.

| Plugin | Status | Plugin |
|---|---|---|
| Local MP3 / files | ✅ Functional | [mp3@built-in](https://omniplayr.wokki20.nl/packages/package/mp3@built-in) |
| Spotify | ✅ Functional | [spotify@built-in](https://omniplayr.wokki20.nl/packages/package/spotify@built-in) |
| YouTube Music | 🔜 Planned | No plugin yet |
| Amazon Music | 🔜 Planned | No plugin yet |
| SoundCloud | 🟧 Not Fully Tested | [soundcloud@built-in](https://omniplayr.wokki20.nl/packages/package/soundcloud@built-in) |

---

## 🚀 Getting Started

### Requirements

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose  
- Python 3.12+  

### Quick Start

```
git clone https://github.com/OmniPlayr/OmniPlayr-server.git
cd OmniPlayr-server
python3 setup.py
```

The setup script installs dependencies and launches the setup wizard. Follow the instructions to get started.

Once ready, open your browser:

```
http://localhost:8223
```

### Manual Docker Start

```
docker compose up -d
```

---

## 📂 Project Structure

```
OmniPlayr/
├── frontend/          # Web UI
├── backend/           # API server
├── setup/             # Setup wizard
├── db/                # PostgreSQL data (auto-created)
├── docker-compose.yml
├── Dockerfile
└── setup.py           # Entry point
```

---

## 🤝 Contributing

OmniPlayr is designed to be **developer-friendly**. You can:

- Create new **plugins** for any audio source
- Add features to the **backend**
- Build or improve the **web UI**

Pull requests and issues are welcome. If you want to discuss a new plugin or feature, open an issue first.

---

## 📜 License

[MIT](LICENSE)
