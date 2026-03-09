import fs from 'fs';

async function download() {
  const res = await fetch('https://raw.githubusercontent.com/MatteoPr0/Iptv-pwa/main/src/pages/Home.tsx');
  const text = await res.text();
  fs.writeFileSync('Home.tsx', text);
}

download();
