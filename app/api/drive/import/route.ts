import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/drive/import
 * Imports medical images from a Google Drive shared folder link.
 * Uses gdown Python package to download files from publicly shared folders.
 */
export async function POST(req: NextRequest) {
  try {
    const { url, patientId } = await req.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Drive URL is required' }, { status: 400 });
    }

    // Extract folder ID from various Google Drive URL formats
    let folderId = url;
    if (folderId.includes('folders/')) {
      folderId = folderId.split('folders/')[1]?.split('?')[0]?.split('/')[0] || folderId;
    } else if (folderId.includes('id=')) {
      folderId = folderId.split('id=')[1]?.split('&')[0] || folderId;
    } else if (folderId.includes('open?id=')) {
      folderId = folderId.split('open?id=')[1]?.split('&')[0] || folderId;
    } else if (folderId.includes('/d/')) {
      folderId = folderId.split('/d/')[1]?.split('/')[0] || folderId;
    }
    folderId = folderId.trim();

    if (!folderId || folderId.length < 10) {
      return NextResponse.json({ error: 'Could not extract valid folder/file ID from URL' }, { status: 400 });
    }

    // Create a unique directory for this download
    const importDir = `/Users/misheladnan/Desktop/omnia-AI/gdrive-imports/${folderId}`;
    const fs = await import('fs/promises');
    
    try {
      await fs.access(importDir);
    } catch {
      await fs.mkdir(importDir, { recursive: true });
    }

    // Run gdown to download the folder
    const { execSync } = await import('child_process');
    
    let output: string;
    try {
      output = execSync(
        `python3 -c "import gdown; gdown.download_folder(id='${folderId.replace(/'/g, "\\'")}', output='${importDir.replace(/'/g, "\\'")}', quiet=True, remaining_ok=True)"`,
        { timeout: 300000, encoding: 'utf-8' }
      );
    } catch (execError: any) {
      console.error('gdown error:', execError.message);
      return NextResponse.json({
        error: `Download failed: ${execError.message}. Make sure the folder is shared with "Anyone with the link can view".`,
      }, { status: 500 });
    }

    // Scan downloaded files
    const { readdir, stat } = await import('fs/promises');
    const path = await import('path');
    
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.dcm', '.tif', '.tiff', '.bmp']);
    const foundFiles: string[] = [];

    async function scanDir(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (imageExts.has(ext)) {
            foundFiles.push(fullPath);
          }
        }
      }
    }

    await scanDir(importDir);

    return NextResponse.json({
      success: true,
      message: `Downloaded ${foundFiles.length} medical images from Google Drive`,
      files: foundFiles.map(f => path.basename(f)),
      importDir,
      totalFiles: foundFiles.length,
    });

  } catch (error: any) {
    console.error('Drive import error:', error);
    return NextResponse.json({ error: error.message || 'Import failed' }, { status: 500 });
  }
}
