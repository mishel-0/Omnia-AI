# Omnia AI

**AI-powered early detection assistant** for lung cancer (X-ray analysis) and skin cancer (image analysis), powered by the **Aaria Neural Engine**.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat&logo=next.js&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat&logo=supabase&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat&logo=firebase&logoColor=black)

## 🧬 Overview

Omnia AI leverages deep learning to assist in the early detection of critical health conditions:

- **Lung Cancer Detection** — analyzes chest X-ray images using a trained CNN model
- **Skin Cancer Classification** — evaluates dermatoscopic images for malignancy indicators

The platform combines a **Next.js 15** frontend with **Supabase** for data storage and **Firebase** for authentication, all integrated with the proprietary Aaria Neural Engine for inference.

## ✨ Features

- 🏥 **Multi-disease detection** (lung & skin cancer)
- 🖼️ **Image upload & analysis** with real-time results
- 🔐 **Firebase Authentication** — secure user login
- 📊 **Supabase backend** — scalable data storage
- 🎨 **Responsive UI** with Tailwind CSS & Framer Motion animations
- 📱 **Mobile-friendly** design

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Next.js 15** | React framework with Turbopack |
| **TypeScript** | Type-safe development |
| **Supabase** | Database & storage |
| **Firebase** | Authentication & backend services |
| **Tailwind CSS** | Utility-first styling |
| **Framer Motion** | Page transitions & animations |
| **Lucide React** | Icon components |

## 🚀 Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
```

## 📁 Project Structure

```
Omnia-AI/
├── app/               # Next.js App Router pages
│   ├── dashboard/     # User dashboard
│   ├── onboarding/    # New user flow
│   ├── page.tsx       # Landing page
│   └── layout.tsx     # Root layout
├── lib/               # Shared utilities
│   ├── firebase.ts    # Firebase config
│   └── utils.ts       # Helper functions
├── supabase/          # Supabase configuration
├── public/            # Static assets
└── components/        # UI components
```

---

Built with ❤️ for early disease detection.
