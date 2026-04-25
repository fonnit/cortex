import { execFile } from 'child_process';

export function claudePrompt(prompt: string): Promise<string> {
  const clean = prompt.replace(/\0/g, '');
  return new Promise((resolve, reject) => {
    execFile('claude', ['-p', clean, '--output-format', 'text'], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`claude cli failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
