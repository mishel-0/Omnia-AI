/** @type {import('next').NextConfig} */

const isDesktop = process.env.EXPORT_DESKTOP === 'true';

const nextConfig = {
	webpack: (config, { isServer }) => {
		if (!isServer) {
			config.resolve.fallback = {
				...config.resolve.fallback,
				fs: false,
				path: false,
				crypto: false,
			};
		}
		return config;
	},
	turbopack: {
		rules: {
			'*.wasm': ['file'],
		},
	},
	typescript: {
		ignoreBuildErrors: false,
	},
	eslint: {
		ignoreDuringBuilds: false,
	},
	allowedDevOrigins: ["*.theopenbuilder.com"],
  ...(isDesktop ? {
    output: 'standalone',
    images: {
      unoptimized: true,
    }
  } : {}),

  // Docker standalone output
  ...(process.env.DOCKER_BUILD === 'true' ? {
    output: 'standalone',
  } : {}),

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' http://localhost:8000 http://127.0.0.1:8000; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:",
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
