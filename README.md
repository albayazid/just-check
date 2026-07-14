# Lumy

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16.1.4-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![React](https://img.shields.io/badge/React-19.2.3-cyan?style=flat-square&logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss)
![AI SDK](https://img.shields.io/badge/AI_SDK-7.0-purple?style=flat-square)
![Supabase](https://img.shields.io/badge/Supabase-Database-green?style=flat-square&logo=supabase)
![Clerk](https://img.shields.io/badge/Clerk-Auth-orange?style=flat-square)

**A sophisticated AI-powered chat application with multi-model support, subscription management, and extensive customization options.**

[Features](#features) • [Tech Stack](#tech-stack) • [Getting Started](#getting-started) • [Project Structure](#project-structure) • [API Reference](#api-reference) • [Database Schema](#database-schema) • [Deployment](#deployment)

</div>

---

## Overview

Lumy is a production-ready AI chat application built with Next.js 16 (App Router) that provides users with access to multiple AI models through a unified interface. The application features a smart model routing system, subscription-based access control, real-time streaming responses, and comprehensive user customization options.

### Key Highlights

- **Multi-Model AI Integration** - Seamlessly switch between different AI models optimized for various tasks
- **Smart Model Routing** - Context-aware routing that automatically selects the best model based on input
- **Subscription System** - Tiered pricing with token-based usage tracking and DodoPayments integration
- **Real-time Streaming** - Live AI responses with tool call support
- **Voice Input** - Speech recognition for hands-free interaction
- **File Attachments** - Upload and preview files in conversations
- **Message Branching** - Support for conversation threading and branching

---

## Features

### AI Models

| Model ID | Technical Model | Capabilities |
|----------|-----------------|--------------|
| `fast` | DeepSeek V3.2 | Standard mode, quick responses |
| `thinker` | DeepSeek V3.2 | Advanced reasoning enabled |
| `pro-thinker` | Moonshot Kimi K2.5 | Complex problem solving |
| `lumy-sense-1` | Mistral Large 2512 | Vision/image analysis |
| `lumy-itor-1` | Moonshot Kimi K2.5 | Code generation & analysis |

### AI Tools

- **Web Search** - AI-powered web search
- **View Website** - Extract and analyze content from URLs
- **Get Weather** - Real-time weather information
- **Get Time** - Current time utility

### User Features

- **Authentication** - Secure sign-in/sign-up with Clerk
- **User Profiles** - Customizable profiles with onboarding flow
- **AI Customization** - Personalize AI tone, response length, and custom instructions
- **Privacy Settings** - Control data sharing and preferences
- **Usage Dashboard** - Track token usage and subscription status
- **Message Feedback** - Rate and provide feedback on AI responses

### Subscription Plans

| Plan | Price | Features |
|------|-------|----------|
| **Free** | $0 | Basic access with limited tokens |
| **Go** | $10/mo | Increased limits, priority support |
| **Plus** | $25/mo | High limits, advanced features |
| **Pro** | $50/mo | Unlimited access, premium support |

---

## Tech Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| Next.js 16.1.4 | React framework with App Router |
| React 19.2.3 | UI library |
| TypeScript 5 | Type-safe development |
| Tailwind CSS 4 | Utility-first styling |
| Radix UI | Accessible UI primitives |
| Framer Motion | Animations and transitions |
| Zustand | Client-side state management |
| TanStack React Query | Server state management |

### Backend & Services

| Technology | Purpose |
|------------|---------|
| Clerk 7.0.1 | Authentication & user management |
| Supabase | PostgreSQL database |
| Vercel AI SDK 7.0 | AI integration framework |
| OpenRouter | AI model provider |
| Google AI | Additional AI provider |
| DodoPayments | Subscription & payment processing |
| Upstash Redis | Rate limiting |

### Development Tools

| Technology | Purpose |
|------------|---------|
| ESLint | Code linting |
| Tailwind CSS PostCSS | CSS processing |
| Tw-animate-css | Tailwind animations |

---

## Getting Started

### Prerequisites

- Node.js 22+ 
- npm, yarn, pnpm, or bun
- Supabase account
- Clerk account
- DodoPayments account (for subscriptions)
- OpenRouter API key

### Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd lumy-with-ai-sdk
```

2. **Install dependencies**

```bash
npm install
# or
yarn install
# or
pnpm install
```

3. **Environment Variables**

Create a `.env.local` file in the root directory:

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

# AI Providers
OPENROUTER_API_KEY=
GOOGLE_AI_API_KEY=

# DodoPayments
DODO_PAYMENTS_API_KEY=
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_WEBHOOK_SECRET=
DODO_PRODUCT_ID_GO_MONTHLY=
DODO_PRODUCT_ID_PLUS_MONTHLY=
DODO_PRODUCT_ID_PRO_MONTHLY=

# Upstash Redis (Rate Limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

4. **Database Setup**

Run the SQL migrations in your Supabase dashboard:

```bash
# Navigate to database/migrations/ and run each SQL file in order:
# 001_complete_profiles_setup.sql
# 002_chat_history_setup.sql
# 003_message_feedback_setup.sql
# 004_user_settings_setup.sql
# 005_message_token_usage_log_setup.sql
# 006_subscription_system_setup.sql
# 007_tool_usage_log.sql
# 008_file_uploads.sql
# 009_signed_url_cache.sql
```

5. **Run Development Server**

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

6. **Open Application**

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure

```
lumy-with-ai-sdk/
├── ai-sdk-v6-docs/           # AI SDK v6 documentation
├── database/
│   └── migrations/           # Supabase SQL migrations
├── dev-docs/                 # Development documentation
├── plans/                    # Feature plans
├── public/                   # Static assets
├── src/
│   ├── app/
│   │   ├── (auth)/           # Authentication pages
│   │   ├── (main)/           # Main app with sidebar
│   │   ├── api/              # API routes
│   │   ├── checkout/         # Payment checkout
│   │   ├── feedback/         # Feedback pages
│   │   ├── settings/         # Settings pages
│   │   └── upgrade/          # Pricing/upgrade page
│   ├── components/
│   │   ├── experimental-components/
│   │   ├── hjls-css-collection/
│   │   ├── messages/         # Message components
│   │   ├── ui/               # UI primitives
│   │   └── ...               # Other components
│   ├── hooks/                # React hooks
│   ├── lib/
│   │   ├── allowance/        # Usage allowance logic
│   │   └── ...               # Utilities
│   ├── providers/            # Context providers
│   ├── stores/               # Zustand stores
│   └── types/                # TypeScript types
├── components.json           # shadcn/ui config
├── eslint.config.mjs         # ESLint configuration
├── next.config.ts            # Next.js configuration
├── package.json              # Dependencies
├── postcss.config.mjs        # PostCSS configuration
└── tsconfig.json             # TypeScript configuration
```

---

## API Reference

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | POST | Main chat endpoint with streaming |
| `/api/conversations` | GET/POST | Conversation management |
| `/api/conversations/[id]` | GET/PUT/DELETE | Individual conversation operations |
| `/api/messages` | GET/POST | Message operations |
| `/api/upload` | POST | File upload handling |
| `/api/attachments` | GET | Attachment URL resolution |

### User & Settings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/profile` | GET/PUT | User profile management |
| `/api/settings` | GET/PUT | User settings CRUD |
| `/api/onboarding` | POST | User onboarding completion |

### Subscription & Usage

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/subscription` | GET | Subscription status |
| `/api/checkout` | POST | Create checkout session |
| `/api/usage` | GET | Usage statistics |
| `/api/webhooks` | POST | DodoPayments webhooks |

### Feedback

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/message-feedback` | POST | Submit message feedback |

---

## Database Schema

### Core Tables

| Table | Description |
|-------|-------------|
| `profiles` | User profiles linked to Clerk authentication |
| `conversations` | Chat sessions with titles and timestamps |
| `messages` | Individual messages with branching support |
| `user_settings` | Privacy and AI customization settings |
| `user_subscriptions` | DodoPayments subscription data |
| `periodic_allowance` | Token usage tracking (daily UTC windows) |
| `message_feedback` | User feedback on AI responses |
| `message_token_usage_log` | Detailed token usage logs |
| `file_uploads` | Attachment metadata |
| `signed_url_cache` | Cached signed URLs for attachments |

### Key Features

- **Message Branching** - Messages can reference previous messages via `previous_message_id`
- **Daily Allowance** - UTC-midnight daily windows for usage limits
- **Soft Deletes** - `deleted_at` columns for data retention
- **Timestamps** - UTC timestamps with automatic updates

---

## Configuration

### Model Routing

The application uses a smart model routing system defined in `src/lib/model-router.ts`:

```typescript
// Example model route configuration
{
  uiModelId: 'fast',
  technicalModel: 'deepseek/deepseek-chat-v3.2',
  provider: 'openrouter',
  reasoning: false
}
```

### Rate Limiting

Rate limiting is configured via Upstash Redis with the following defaults:

- **Chat API**: 20 requests per 6 hours
- **Upload API**: 10 requests per hour
- **General API**: 100 requests per hour

---

## Deployment

### Vercel (Recommended)

1. Push your code to a Git repository
2. Import the project in Vercel
3. Configure environment variables
4. Deploy

### Docker

```bash
# Build the image
docker build -t oearol-lumy .

# Run the container
docker run -p 3000:3000 oearol-lumy
```

### Manual Deployment

```bash
# Build the application
npm run build

# Start the production server
npm start
```

---

## Development

### Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Code Style

The project uses ESLint with Next.js configuration. Run `npm run lint` to check for issues.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is private and proprietary. All rights reserved.

---

## Support

For support, please contact the development team or open an issue in the repository.

---

<div align="center">

**Built with Next.js, AI SDK, and ❤️**

</div>
