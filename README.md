# OmniPlayr 🎵

> A self-hosted, extensible media player - play everything from one place.

OmniPlayr is a work-in-progress media player built around a plugin system. Once complete, you'll be able to plug in any streaming service or local source you want - Spotify, YouTube Music, Amazon Music, SoundCloud, local MP3s, and more.

## ⚠️ Work in Progress

This project is in active development. Expect breaking changes, missing features, and rough edges. Contributions and ideas are very welcome.

## Features (planned & in progress)

- 🔌 Plugin architecture - install only the sources you need
- 🎧 Unified playback interface across all plugins
- 📦 Self-hosted via Docker
- 🌐 Web UI accessible from any device on your network

## Plugin Support (roadmap)

| Plugin | Status |
|---|---|
| Local MP3 / files | 🔜 Planned |
| Spotify | 🔜 Planned |
| YouTube Music | 🔜 Planned |
| Amazon Music | 🔜 Planned |
| SoundCloud | 🔜 Planned |
| More... | 🔜 Planned |

## Getting Started

### Requirements

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- Python 3.12+

### Quick Start

```bash
git clone https://github.com/OmniPlayr/OmniPlayr-server.git
cd OmniPlayr-server
python3 setup.py
```

The setup script will install dependencies and launch the setup wizard. Follow the on-screen instructions to get everything running.

Once set up, open your browser and go to:

```
http://localhost:3000
```

### Manual Docker Start

```bash
docker compose up -d
```

## Project Structure

```
OmniPlayr/
├── frontend/          # Web UI
├── backend/           # API server
├── setup/             # Setup wizard (web-based)
├── db/                # PostgreSQL data (auto-created)
├── docker-compose.yml
├── Dockerfile
└── setup.py           # Entry point
```

## Contributing

Pull requests are welcome! If you have an idea for a plugin or a feature, feel free to open an issue first to discuss it.

## License

[MIT](LICENSE)