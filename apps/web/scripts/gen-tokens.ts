import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TokensFile {
  color: {
    tokens: Array<{
      name: string;
      value: { light: string; dark: string };
    }>;
  };
  spacing: {
    tokens: Array<{
      name: string;
      value: string;
    }>;
  };
  radius: {
    tokens: Array<{
      name: string;
      value: string;
    }>;
  };
  size: {
    tokens: Array<{
      name: string;
      value: string;
    }>;
  };
}

function generateTokensCss(): string {
  const tokensPath = path.resolve(__dirname, '../../../design/ds/devicenet/tokens.json');
  const content = fs.readFileSync(tokensPath, 'utf-8');
  const tokens: TokensFile = JSON.parse(content);

  let css = ':root {\n';

  // Color tokens (light theme)
  for (const token of tokens.color.tokens) {
    css += `  --${token.name}: ${token.value.light};\n`;
  }

  // Spacing tokens
  for (const token of tokens.spacing.tokens) {
    css += `  --${token.name}: ${token.value};\n`;
  }

  // Radius tokens
  for (const token of tokens.radius.tokens) {
    css += `  --${token.name}: ${token.value};\n`;
  }

  // Size tokens
  for (const token of tokens.size.tokens) {
    css += `  --${token.name}: ${token.value};\n`;
  }

  css += '}\n\n';

  // Dark theme overrides
  css += '.dark {\n';
  for (const token of tokens.color.tokens) {
    css += `  --${token.name}: ${token.value.dark};\n`;
  }
  css += '}\n';

  return css;
}

async function main() {
  const isCheckMode = process.argv.includes('--check');
  const outputPath = path.resolve(__dirname, '../src/styles/tokens.css');

  const newContent = generateTokensCss();

  if (isCheckMode) {
    const existingContent = fs.readFileSync(outputPath, 'utf-8');
    if (existingContent !== newContent) {
      console.error('tokens.css is out of sync. Run: pnpm gen:tokens');
      process.exit(1);
    }
    console.log('✓ tokens.css is up to date');
  } else {
    fs.writeFileSync(outputPath, newContent, 'utf-8');
    console.log('✓ Generated tokens.css');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
