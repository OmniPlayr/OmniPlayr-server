# OmniPlayr 🎵

> A self-hosted, extensible media platform - unify audio and video streaming from multiple sources.  

OmniPlayr is a **self-hosted, plugin-based media platform** that lets you stream and manage media from different sources through a single, consistent API. The backend and plugin system are fully functional, and the project is designed for developers to add new plugins and extend the platform.

---

## ⚠️ Work in Progress

This project is under active development. While the **streaming backend and plugin system are working**, the web UI is still being built. Contributions, ideas, and plugins are highly welcome.

---

## ✅ Features

- 🔌 **Plugin architecture** - easily add new audio or video sources
- 🎧 **Unified streaming API** - clients can access media without knowing the source plugin
- 📦 **Self-hosted** - deploy with Docker or Python
- 🌐 **Web UI coming soon** - control your media from any device

---

## 🛠 Plugin Support

Each media source is implemented as a plugin. The **MP3 plugin is fully functional**, and more sources can be added easily.

| Plugin | Status |
|---|---|
| Local MP3 / files | ✅ Functional |
| Spotify | 🔜 Planned |
| YouTube Music | 🔜 Planned |
| Amazon Music | 🔜 Planned |
| SoundCloud | 🔜 Planned |
| Video sources | 🔜 Planned |

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
http://localhost:3000
```

### Manual Docker Start

```
docker compose up -d
```

---

## 📂 Project Structure

```
OmniPlayr/
├── frontend/          # Web UI (WIP)
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

- Create new **plugins** for any audio or video source  
- Add features to the **backend**  
- Build or improve the **web UI**  

Pull requests and issues are welcome. If you want to discuss a new plugin or feature, open an issue first.

---

## 📜 License

[MIT](LICENSE)