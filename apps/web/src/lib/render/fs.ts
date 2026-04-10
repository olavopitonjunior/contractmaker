import fs from 'fs';
import path from 'path';

export function ensureDir(filePath: string): void {
  const dir = path.extname(filePath) ? path.dirname(filePath) : filePath;
  fs.mkdirSync(dir, { recursive: true });
}
