import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Abilita CORS per tutte le origini
  app.use(cors());

  app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url as string;

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16',
      };
      
      // Inoltra l'header Range se presente
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const response = await fetch(targetUrl, {
        headers,
      });

      if (!response.ok && response.status !== 206) {
        return res.status(response.status).json({ error: `Target responded with status ${response.status}` });
      }

      // Imposta lo status code (es. 206 per Partial Content)
      res.status(response.status);

      // Inoltra gli header importanti
      const headersToForward = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
      headersToForward.forEach(header => {
        const value = response.headers.get(header);
        if (value) {
          res.setHeader(header, value);
        }
      });

      const contentType = response.headers.get('content-type');

      // Se è una richiesta API (JSON), parsala e inviala
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        return res.json(data);
      }

      // Se è un file m3u8, riscriviamo gli URL per farli passare dal proxy
      if (contentType?.includes('application/vnd.apple.mpegurl') || contentType?.includes('audio/mpegurl') || targetUrl.includes('.m3u8')) {
        let m3u8Content = await response.text();
        const baseUrl = new URL(response.url || targetUrl);
        
        m3u8Content = m3u8Content.split('\n').map(line => {
          line = line.trim();
          if (line && !line.startsWith('#')) {
            // È un URL di un segmento o di un'altra playlist
            try {
              const segmentUrl = new URL(line, baseUrl).toString();
              // Riscrivi l'URL per farlo passare dal proxy
              const reqHost = req.headers.host;
              const reqProtocol = req.protocol || 'http';
              // Usiamo un percorso relativo o assoluto in base a come è chiamato il proxy
              return `/proxy?url=${encodeURIComponent(segmentUrl)}`;
            } catch (e) {
              return line;
            }
          }
          return line;
        }).join('\n');
        
        return res.send(m3u8Content);
      }

      // Altrimenti, inoltra lo stream (es. video o m3u8)
      if (response.body) {
        // @ts-ignore - Node.js fetch body is a ReadableStream
        const reader = response.body.getReader();
        
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                break;
              }
              res.write(value);
            }
          } catch (err) {
            console.error('Stream error:', err);
            res.end();
          }
        };
        
        await pump();
      } else {
        res.end();
      }
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).json({ error: 'Proxy request failed' });
    }
  });

  // Endpoint di test per verificare che il server sia su
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
