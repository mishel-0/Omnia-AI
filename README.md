# 🤖 Omnia AI

[![Next.js](https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com)

> **AI-powered early detection assistant** for lung cancer (X-rays) and skin cancer (dermatoscopic images), powered by the **Aaria Neural Engine**.

---

## 🧬 The Problem

Cancer remains one of the leading causes of death worldwide, with early detection being the single most important factor in successful treatment. However, access to specialist radiologists and dermatologists is limited, especially in underserved regions. **Omnia AI bridges this gap** by making preliminary screening accessible through AI.

## 💡 The Solution

Omnia AI uses deep learning models trained on medical imaging datasets to analyze:
- **Chest X-rays** — detecting signs of lung cancer with high sensitivity
- **Dermatoscopic images** — classifying skin lesions as benign or malignant

The platform provides a clean, responsive interface where users can upload medical images and receive instant AI-assisted analysis.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🏥 **Multi-Disease Detection** | Lung cancer & skin cancer classification |
| 🖼️ **Real-Time Analysis** | Upload images and get results instantly |
| 🔐 **Secure Auth** | Firebase Authentication with user profiles |
| 📊 **Patient History** | Track analyses over time with Supabase |
| 📱 **Responsive UI** | Works on desktop, tablet, and mobile |
| 🎯 **Confidence Scores** | Each prediction includes probability metrics |

---

## 🛠️ Tech Stack

| Technology | Role |
|------------|------|
| Next.js 15 | Web framework with App Router & Turbopack |
| TypeScript | Type-safe application code |
| Supabase | Database, storage, and real-time sync |
| Firebase Auth | User authentication & session management |
| Tailwind CSS | Utility-first responsive design |
| Framer Motion | Page transitions & micro-interactions |
| Aaria Neural Engine | Deep learning inference for medical images |

---

## 🚀 Getting Started

```bash
# Clone & install
git clone https://github.com/mishel-0/Omnia-AI.git
cd Omnia-AI
npm install

# Set up environment
# Create .env.local with your Supabase & Firebase credentials
echo "
NEXT_PUBLIC_SUPABASE_URL=your-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-key
NEXT_PUBLIC_FIREBASE_API_KEY=your-key
" > .env.local

# Run development server
npm run dev
```

---

## 📁 Project Structure

```
Omnia-AI/
├── app/               # Next.js App Router
│   ├── dashboard/     # User dashboard (analysis results)
│   ├── onboarding/    # New user setup flow
│   ├── page.tsx       # Landing page
│   └── layout.tsx     # Root layout with auth
├── lib/               # Firebase & Supabase configs
├── supabase/          # Database schema & migrations
├── public/            # Static assets
└── components/        # UI components
```

---

## 🧠 Model Details

| Model | Input | Output |
|-------|-------|--------|
| Lung Cancer CNN | Chest X-ray (DICOM/JPEG) | Positive/Negative + confidence |
| Skin Cancer CNN | Dermatoscopic image | Benign/Malignant + confidence |

> ⚠️ **Medical Disclaimer**: Omnia AI is an assistive tool and does not replace professional medical diagnosis. Always consult a qualified healthcare provider.

---

## 🖼️ Screenshots

*Coming soon — dashboard previews and analysis workflow*

---

## 🌐 Links

- **GitHub**: [mishel-0/Omnia-AI](https://github.com/mishel-0/Omnia-AI)
- **Report Issues**: [Open an issue](https://github.com/mishel-0/Omnia-AI/issues)

---

<p align="center">
  <i>Built with ❤️ for early disease detection</i>
</p>