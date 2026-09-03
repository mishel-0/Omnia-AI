'use client';

/**
 * The window: two inset panels on the application's own ground.
 *
 * This exists as a component rather than as markup inside the layout because
 * the preview harnesses need the same shell, and when they carried their own
 * copy it drifted — a shell fix landed in the layout, and measuring through a
 * preview reported the old geometry back as if it were current. A harness that
 * can disagree with the thing it is previewing is worse than no harness.
 *
 * The window itself does not scroll; the content panel does. Scrolling the
 * window put the scrollbar inside the right-hand margin — 10px on the left
 * against 14px on the right, measured — and let the panel grow past the foot
 * of the rail, so its rounded bottom sat below the fold and the two panels
 * never ended on the same line.
 */

import React from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen gap-2.5 p-2.5 bg-[var(--shell-bg)] overflow-hidden">
      <Sidebar />
      <div className="shell-panel flex-1 min-w-0 flex flex-col rounded-[26px] overflow-y-auto custom-scrollbar">
        <TopBar />
        {children}
      </div>
    </div>
  );
}
