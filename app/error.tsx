'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="h-screen flex items-center justify-center bg-[#0a0e17] text-white p-8">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
        <p className="text-gray-400 mb-6 text-sm">{error.message}</p>
        <button onClick={reset} className="px-6 py-2 bg-[#007AFF] rounded-xl text-sm font-bold hover:opacity-90">
          Try again
        </button>
      </div>
    </div>
  );
}
