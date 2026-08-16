# ⚡ PocketDev Backend — Autonomous AI Software Engineering Engine

[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Anthropic](https://img.shields.io/badge/Anthropic_Claude-D97706?style=for-the-badge&logo=anthropic&logoColor=white)](https://www.anthropic.com/)

**PocketDev Backend** is the high-performance, asynchronous orchestration server powering the PocketDev platform. Built on **NestJS**, **Docker**, **Prisma (PostgreSQL)**, and the **Anthropic Claude API**, it enables developers to build, test, and ship code directly to GitHub repositories from mobile and web apps without opening a laptop.

---

## 🌟 Key Capabilities & Features

- 🤖 **Multi-Model AI Orchestrator**: Integrated with Anthropic's Claude 5 & 4.5 family (Claude Haiku 4.5, Sonnet 5, Opus 5, Fable 5) using the Vercel AI SDK.
- 🐳 **Isolated Docker Workspaces**: Dynamically spins up isolated Linux Docker containers for every task to clone GitHub repos, run package managers (`npm`, `pip`, `cargo`, etc.), execute bash commands, and host live preview servers.
- 📋 **Two-Step AI Agent Architecture**:
  1. **Planning Phase**: Analyzes repo file structure and dynamic project setup strategy, streaming a structured Markdown plan via WebSockets.
  2. **Autonomous Execution Phase**: Iteratively executes bash commands (up to 10 loops) inside Docker containers, reading outputs and adjusting code dynamically.
- 🔀 **Multi-Repo (Dual Workspace) Editing**: Edit both a primary repository (e.g. Next.js frontend) and secondary repository (e.g. NestJS backend) simultaneously within a unified cloud workspace.
- 💰 **Tiered Monetization & Quota Engine**: Enforces Monthly Task and Token Quotas for **Free**, **Premium ($9.99/mo)**, and **Pro ($24.99/mo)** tiers.
- 💳 **Webhook Integrations**: Automated subscription management via **Lemon Squeezy** (web) and **RevenueCat** (mobile).
- ⚡ **Real-Time Streaming**: **Socket.io Gateways** for live WebSocket log streaming and interactive plan updates.
- 🔔 **Asynchronous Push Notifications**: Background job processing via **BullMQ & Redis** with push notifications sent via Expo Push Service upon task completion.

---

## 🏗️ System Architecture & Workflow

```
               ┌────────────────────────────────────────────────────────┐
               │    Client Applications (Web Next.js / Mobile Expo)      │
               └───────────────────────────┬────────────────────────────┘
                                           │ HTTP / WebSockets (Socket.io)
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │             NestJS Backend (PocketDev Engine)          │
               └───────┬───────────────────┬───────────────────┬────────┘
                       │                   │                   │
        ┌──────────────┴──────┐  ┌─────────┴─────────┐  ┌──────┴──────────────┐
        │  Prisma / PostgreSQL│  │ Anthropic AI SDK  │  │   Docker Engine    │
        │   (Neon Cloud DB)   │  │ (Claude 5/4.5)    │  │ (Isolated Containers)│
        └─────────────────────┘  └───────────────────┘  └─────────────────────┘
```

---

## 🛠️ Tech Stack

- **Framework**: NestJS 10 (TypeScript)
- **Database**: PostgreSQL (Neon Cloud DB) with Prisma ORM 6
- **Queueing & Async Tasks**: BullMQ + Redis
- **Containerization**: Docker Engine (Dockerode SDK)
- **AI Models**: Vercel AI SDK (`@ai-sdk/anthropic`)
- **WebSockets**: `@nestjs/websockets` + `socket.io`
- **Monetization**: Lemon Squeezy Webhooks & RevenueCat SDK

---

## 🔑 Environment Variables

Create a `.env` file in the root directory:

```env
# Application
PORT=3000
NODE_ENV=development

# Database (PostgreSQL / Neon)
DATABASE_URL="postgresql://user:password@host.neon.tech/neondb?sslmode=require"

# Anthropic AI API Key
ANTHROPIC_API_KEY="sk-ant-api03-..."

# GitHub OAuth App Credentials
GITHUB_CLIENT_ID="your_github_client_id"
GITHUB_CLIENT_SECRET="your_github_client_secret"
GITHUB_CALLBACK_URL="https://your-domain.com/auth/github/callback"

# Redis (BullMQ Queue)
REDIS_HOST="localhost"
REDIS_PORT=6379
REDIS_PASSWORD=""

# Lemon Squeezy (Web Payments)
LEMONSQUEEZY_WEBHOOK_SECRET="your_lemonsqueezy_secret"

# RevenueCat (Mobile Subscriptions)
REVENUECAT_WEBHOOK_SECRET="your_revenuecat_secret"
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.x
- Docker Engine running locally or on server
- PostgreSQL database (or Neon DB instance)
- Redis server (or Upstash Redis)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Success1050/pocketDev-backend.git
   cd pocketDev-backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Database Migration & Prisma Client**:
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

4. **Start the Development Server**:
   ```bash
   npm run start:dev
   ```

5. **Build for Production**:
   ```bash
   npm run build
   npm run start:prod
   ```

---

## 💖 Supporting the Project & Token Funding

Running state-of-the-art LLMs (such as **Claude Opus 5** and **Claude Sonnet 5**) alongside Docker container infrastructure incurs **substantial API token and cloud server expenses**. 

If you find **PocketDev** valuable, love the project, or want to support our mission to bring friction-free mobile software engineering to everyone, please consider **sponsoring or contributing token credits**:

- **Anthropic API Credits / Token Grants**: Help us keep high-capacity AI models accessible to open-source developers.
- **Sponsorship & Donations**: Get in touch to support server infrastructure (AWS EC2, Neon DB, Redis).

---

## 📬 Contact & Developer Info

Developed with ❤️ by **Emmanuel Ekwunife**.

- 📧 **Email**: [emmanuelekwunife58@gmail.com](mailto:emmanuelekwunife58@gmail.com)
- 🐙 **GitHub**: [@Success1050](https://github.com/Success1050)
- 💼 **Project Status**: Currently in active **MVP Testing**. Feedback & contributions are warmly welcomed!

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
